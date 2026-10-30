import { TRPCError } from "@trpc/server";
import { asc, inArray } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { requestInput } from "@/lib/request-input";
import { type Actor, clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { answerDeps, readFhirPatient } from "@/server/answers/deps";
import { logReason } from "@/server/answers/file";
import { acceptAnswer, FilingOutcomeOpen, NoHeldAnswer, rejectAnswer } from "@/server/answers/held";
import { auditActor, recordAudit } from "@/server/audit/record";
import type { Db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { type AddressCheck as EhvdAddressCheck, addressWarning, checkAddress } from "@/server/ehvd/address-check";
import { nameWords } from "@/server/identity/names";
import { MessageRefused, sendRequestEmail } from "@/server/mail/send";
import { displayName } from "@/server/matrix/client";
import { taskStatus, TransitionError } from "@/server/requests/lifecycle";
import {
  type AddressCheck,
  applyEvent,
  createRequest,
  getRequest,
  listRequests,
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

function conflict(e: unknown): never {
  if (e instanceof TransitionError) throw new TRPCError({ code: "CONFLICT", message: e.message, cause: e });
  throw e;
}

const DECIDED = { accept: "accepted", reject: "rejected", cancel: "cancelled" } as const;

type DecideContext = { db: Db; actor: Extract<Actor, { kind: "clinic" }>; request: RequestRow };

async function decide(ctx: DecideContext, event: keyof typeof DECIDED) {
  if (ctx.request.state === "answer_held" && event !== "cancel") return decideHeldAnswer(ctx, event);
  const request = await applyEvent(ctx.db, ctx.request.id, event, async (tx, changed, from) => {
    // The answer arrived and was held since the request was read: only the answer flow files or drops it.
    if (from === "answer_held" && event !== "cancel") throw new TransitionError(from, event);
    await recordAudit(tx, {
      event: "request_decided",
      requestId: changed.id,
      actor: auditActor(ctx.actor),
      outcome: DECIDED[event],
      detail: { from, to: changed.state },
    });
  }).catch(conflict);
  if (!request) throw notFound(ctx.request.id);
  return request;
}

/**
 * Accept files a held answer and Reject drops it, through the answer flow (docs/ARCHITECTURE.md, "The answer"). Both
 * write `request_decided` in the transaction that changes the state. A failed filing leaves the request held.
 */
async function decideHeldAnswer(ctx: DecideContext, event: "accept" | "reject") {
  const id = ctx.request.id;
  try {
    const request = event === "accept" ? await acceptAnswer(answerDeps, id, ctx.actor.mxid) : await rejectAnswer(answerDeps, id, ctx.actor.mxid);
    if (!request) throw new TRPCError({ code: "CONFLICT", message: `Request ${id} changed in the meantime. Reload and decide again.` });
    return request;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof NoHeldAnswer) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This request has no held answer to file." });
    if (error instanceof FilingOutcomeOpen) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The last Accept may have filed the answer. Click Accept again to finish it." });
    }
    // A database error's message carries the document text and the ID token; neither goes to the widget or the log.
    console.error(`${event} on the held answer to request ${id} failed: ${logReason(error)}`);
    const message = event === "accept" ? "Filing the answer failed. The answer stays held; try Accept again in a few minutes." : "Rejecting the answer failed. Try again in a few minutes.";
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
  }
}

const auditOf = (db: Db, ids: number[]) =>
  db.select().from(auditLog).where(inArray(auditLog.requestId, ids)).orderBy(asc(auditLog.at), asc(auditLog.id));

export const linkDeps = { readPatient: readFhirPatient, sendRequestEmail };

async function sendLink(request: RequestRow, token: string) {
  const link = `${env.PUBLIC_URL}/r/${token}`;
  if (request.channel === "sms") {
    if (env.NODE_ENV === "development") console.info(`Request ${request.id}: ${link}`);
    return;
  }
  try {
    const patient = await linkDeps.readPatient(request.patientId);
    await linkDeps.sendRequestEmail({ to: request.address, requester: request.requesterName, clinic: env.CLINIC_NAME, link, expiresAt: request.expiresAt, patient });
  } catch (error) {
    // A refused SMTP connection has an empty message; Nodemailer puts the reason in `code`, such as ESOCKET.
    const code = error instanceof Error && "code" in error ? ` (${String(error.code)})` : "";
    console.error(`The email for request ${request.id} was not sent: ${logReason(error)}${code}`);
    if (error instanceof MessageRefused) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `The email would contain ${error.categories.join(", ")}, so it was not sent. The request did not go out.` });
    }
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The email could not be sent. The request did not go out; try again in a few minutes." });
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
    const { request } = await createRequest(
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
      sendLink,
    );
    return { ...summary(request), addressWarning: check.result === "pass" ? null : addressWarning(check, input.org) };
  }),

  get: ownRequestProcedure.query(async ({ ctx }) => {
    const audit = await auditOf(ctx.db, [ctx.request.id]);
    return { ...summary(ctx.request), addressWarning: pendingWarning(ctx.request, audit), audit };
  }),

  list: clinicProcedure.query(async ({ ctx }) => {
    const listed = await listRequests(ctx.db, ctx.actor.mxid);
    const audit = await auditOf(ctx.db, listed.map((r) => r.id));
    return listed.map((r) => {
      const own = audit.filter((a) => a.requestId === r.id);
      return { ...summary(r), addressWarning: pendingWarning(r, own), audit: own };
    });
  }),

  /** Dr. Hofer confirms the address after the warning. The request goes out with a new 7-day link. */
  sendAnyway: ownRequestProcedure.mutation(async ({ ctx }) => {
    const sent = await sendAnyway(ctx.db, ctx.request.id, auditActor(ctx.actor), sendLink).catch(conflict);
    if (!sent) throw notFound(ctx.request.id);
    return summary(sent.request);
  }),

  accept: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "accept"))),

  reject: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "reject"))),

  cancel: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "cancel"))),
});
