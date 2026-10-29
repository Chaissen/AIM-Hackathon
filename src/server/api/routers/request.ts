import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { requestInput } from "@/lib/request-input";
import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import type { Db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { nameWords } from "@/server/identity/names";
import { displayName } from "@/server/matrix/client";
import { type RequestEvent, taskStatus, TransitionError } from "@/server/requests/lifecycle";
import { applyEvent, createRequest, getRequest, listRequests, type RequestRow } from "@/server/requests/service";

// Postgres `serial` ends at 2^31 - 1; a larger id would reach the database as an error.
const byId = z.object({ id: z.number().int().positive().max(2_147_483_647) });

// What network members see of a request. An allowlist, so the link hash never leaves the server.
const summary = (r: RequestRow) => ({
  id: r.id,
  docType: r.docType,
  patientId: r.patientId,
  given: r.given,
  family: r.family,
  org: r.org,
  channel: r.channel,
  address: r.address,
  requester: r.requester,
  requesterName: r.requesterName,
  state: r.state,
  taskStatus: taskStatus(r.state),
  failedChecks: r.failedChecks,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
});

const notFound = (id: number) => new TRPCError({ code: "NOT_FOUND", message: `Request ${id} does not exist` });

// A network member sees and changes only the requests they sent. Someone else's request reads as not found,
// so its existence does not leak either.
const ownRequestProcedure = clinicProcedure.input(byId).use(async ({ ctx, input, next }) => {
  const request = await getRequest(ctx.db, input.id);
  if (request?.requester !== ctx.actor.mxid) throw notFound(input.id);
  return next({ ctx: { ...ctx, request } });
});

async function change(ctx: { db: Db; request: RequestRow }, event: RequestEvent) {
  try {
    const request = await applyEvent(ctx.db, ctx.request.id, event);
    if (!request) throw notFound(ctx.request.id);
    return request;
  } catch (e) {
    if (e instanceof TransitionError) throw new TRPCError({ code: "CONFLICT", message: e.message, cause: e });
    throw e;
  }
}

export const requestRouter = createTRPCRouter({
  create: clinicProcedure.input(requestInput).mutation(async ({ ctx, input }) => {
    const contact = input.email
      ? { channel: "email" as const, address: input.email }
      : input.phone
        ? { channel: "sms" as const, address: input.phone }
        : null;
    if (!contact) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an email address or a mobile number" });
    // An empty set of name words passes every subset test of the name match (docs/IDENTITY.md), so "-" alone is no name.
    if (!nameWords(input.given).size || !nameWords(input.family).size) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the person's given name and family name" });
    }

    const { request, token } = await createRequest(
      ctx.db,
      {
        docType: input.docType,
        patientId: input.patient,
        given: input.given,
        family: input.family,
        org: input.org,
        ...contact,
        requester: ctx.actor.mxid,
        requesterName: (await displayName(ctx.actor.mxid)) ?? ctx.actor.mxid,
      },
      // TODO(T15): the address check against the eHVD decides this.
      { addressCheckPassed: true },
    );
    // TODO(T06): send the link by email or SMS. Until then, print it in development so the portal can be tried.
    if (env.NODE_ENV === "development") console.info(`Request ${request.id}: ${env.PUBLIC_URL}/r/${token}`);
    return summary(request);
  }),

  get: ownRequestProcedure.query(async ({ ctx }) => {
    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.requestId, ctx.request.id)).orderBy(asc(auditLog.at), asc(auditLog.id));
    return { ...summary(ctx.request), audit };
  }),

  list: clinicProcedure.query(async ({ ctx }) => (await listRequests(ctx.db, ctx.actor.mxid)).map(summary)),

  cancel: ownRequestProcedure.mutation(async ({ ctx }) => summary(await change(ctx, "cancel"))),
});
