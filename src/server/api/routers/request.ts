import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { requestInput } from "@/lib/request-input";
import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { auditActor } from "@/server/audit/record";
import type { Db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { type AddressCheck as EhvdAddressCheck, addressWarning, checkAddress } from "@/server/ehvd/address-check";
import { nameWords } from "@/server/identity/names";
import { displayName } from "@/server/matrix/client";
import { taskStatus, TransitionError } from "@/server/requests/lifecycle";
import {
  type AddressCheck,
  applyEvent,
  createRequest,
  getRequest,
  listRequests,
  type NonLoginEvent,
  type RequestRow,
  sendAnyway,
} from "@/server/requests/service";

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

/** The eHVD's answer as the request service stores it (docs/EHVD.md, "The address check"). */
const stored = (check: EhvdAddressCheck): AddressCheck =>
  check.result === "pass"
    ? { passed: true }
    : check.result === "mismatch"
      ? { passed: false, domain: check.domain, expectedDomain: check.expectedDomain }
      : { passed: false, unchecked: true };

/**
 * The warning next to Send anyway for a request that waits for it. A mismatch is rebuilt from its audit entry. Why
 * the eHVD could not confirm an address is not stored, so a reload says only that.
 */
function pendingWarning(request: RequestRow, audit: (typeof auditLog.$inferSelect)[]): string | null {
  if (request.state !== "awaiting_confirmation") return null;
  const caught = audit.find((a) => a.event === "misdelivery_caught" && a.outcome === "address_mismatch");
  const detail = caught?.detail as { domain: string; expectedDomain: string } | undefined;
  return detail
    ? addressWarning({ result: "mismatch", domain: detail.domain, expectedDomain: detail.expectedDomain }, request.org)
    : "The eHVD could not confirm the address, so the request has not been sent.";
}

// TODO(T06): send the link by email or SMS. Until then, print it in development so the portal can be tried.
function printLink(request: RequestRow, token: string) {
  if (env.NODE_ENV === "development" && request.state === "sent") console.info(`Request ${request.id}: ${env.PUBLIC_URL}/r/${token}`);
}

async function change(ctx: { db: Db; request: RequestRow }, event: NonLoginEvent) {
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

    // The address check against the eHVD (T15). An SMS always passes it.
    const check = await checkAddress({ ...contact, org: input.org });
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
      stored(check),
    );
    printLink(request, token);
    return { ...summary(request), addressWarning: check.result === "pass" ? null : addressWarning(check, input.org) };
  }),

  get: ownRequestProcedure.query(async ({ ctx }) => {
    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.requestId, ctx.request.id)).orderBy(asc(auditLog.at), asc(auditLog.id));
    return { ...summary(ctx.request), addressWarning: pendingWarning(ctx.request, audit), audit };
  }),

  list: clinicProcedure.query(async ({ ctx }) => (await listRequests(ctx.db, ctx.actor.mxid)).map(summary)),

  cancel: ownRequestProcedure.mutation(async ({ ctx }) => summary(await change(ctx, "cancel"))),

  /** Dr. Hofer confirms the address after the warning. The request goes out with a new 7-day link. */
  sendAnyway: ownRequestProcedure.mutation(async ({ ctx }) => {
    try {
      const sent = await sendAnyway(ctx.db, ctx.request.id, auditActor(ctx.actor));
      if (!sent) throw notFound(ctx.request.id);
      printLink(sent.request, sent.token);
      return summary(sent.request);
    } catch (e) {
      if (e instanceof TransitionError) throw new TRPCError({ code: "CONFLICT", message: e.message, cause: e });
      throw e;
    }
  }),
});
