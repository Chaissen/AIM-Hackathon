import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { requestInput } from "@/lib/request-input";
import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import type { Db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { displayName } from "@/server/matrix/client";
import { type RequestEvent, taskStatus, TransitionError } from "@/server/requests/lifecycle";
import { applyEvent, createRequest, getRequest, listRequests, type RequestRow } from "@/server/requests/service";

const byId = z.object({ id: z.number().int().positive() });

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

async function change(db: Db, id: number, event: RequestEvent) {
  try {
    const request = await applyEvent(db, id, event);
    if (!request) throw new TRPCError({ code: "NOT_FOUND", message: `Request ${id} does not exist` });
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

  get: clinicProcedure.input(byId).query(async ({ ctx, input }) => {
    const request = await getRequest(ctx.db, input.id);
    if (!request) throw new TRPCError({ code: "NOT_FOUND", message: `Request ${input.id} does not exist` });
    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.requestId, input.id)).orderBy(asc(auditLog.at), asc(auditLog.id));
    return { ...summary(request), audit };
  }),

  list: clinicProcedure.query(async ({ ctx }) => (await listRequests(ctx.db)).map(summary)),

  cancel: clinicProcedure.input(byId).mutation(async ({ ctx, input }) => summary(await change(ctx.db, input.id, "cancel"))),
});
