import { TRPCError } from "@trpc/server";
import { asc, inArray } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { addressWarning, type AddressCheck as EhvdAddressCheck } from "@/lib/address-check";
import { patientId, requestInput } from "@/lib/request-input";
import { notFound, ownRequestProcedure } from "@/server/api/own-request";
import { type Actor, clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { answerDeps, readFhirPatient } from "@/server/answers/deps";
import { logReason } from "@/server/answers/file";
import { acceptAnswer, FilingOutcomeOpen, NoHeldAnswer, rejectAnswer } from "@/server/answers/held";
import { auditActor, recordAudit } from "@/server/audit/record";
import type { Db, Tx } from "@/server/db";
import { auditLog, heldAnswers, keptAnswers } from "@/server/db/schema";
import { checkAddress, checkRecipient } from "@/server/ehvd/address-check";
import { FhirError } from "@/server/fhir/client";
import { nameWords } from "@/server/identity/names";
import { forbiddenContent, requestEmail, requestSms } from "@/server/mail/message";
import { IncompletePatient, MessageRefused, sendRequestEmail } from "@/server/mail/send";
import { displayName } from "@/server/matrix/client";
import { taskStatus, TransitionError } from "@/server/requests/lifecycle";
import { LINK_TTL_MS } from "@/server/requests/link-token";
import { notifyRequest } from "@/server/requests/notify";
import { pendingDecision } from "@/server/requests/pending";
import {
  type AddressCheck,
  applyEvent,
  createRequest,
  findBinding,
  listRequests,
  type RequestRow,
  sendAnyway,
} from "@/server/requests/service";
import { NoSmsGateway, sendRequestSms } from "@/server/requests/sms";

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

/** The eHVD's answer as the request service stores it (docs/EHVD.md, "The address check"). */
const stored = (check: EhvdAddressCheck): AddressCheck =>
  check.result === "pass"
    ? { passed: true }
    : check.result === "mismatch"
      ? { passed: false, domain: check.domain, expectedDomain: check.expectedDomain }
      : { passed: false, unchecked: true };

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

/**
 * Each request with its audit entries and the decision it waits for. Of a held answer only the sender, the reason, and
 * the time leave the server; its text and ID token stay (`document.forRequest` shows the text).
 */
async function withPending(db: Db, rows: RequestRow[]) {
  const ids = rows.map((r) => r.id);
  const [audit, held, kept] = await Promise.all([
    auditOf(db, ids),
    db
      .select({ requestId: heldAnswers.requestId, sender: heldAnswers.sender, reason: heldAnswers.reason, sentAt: heldAnswers.sentAt })
      .from(heldAnswers)
      .where(inArray(heldAnswers.requestId, ids)),
    db.select({ requestId: keptAnswers.requestId }).from(keptAnswers).where(inArray(keptAnswers.requestId, ids)),
  ]);
  return rows.map((r) => {
    const own = audit.filter((a) => a.requestId === r.id);
    const pending = pendingDecision(r, own, held.find((h) => h.requestId === r.id) ?? null, kept.some((k) => k.requestId === r.id));
    return { ...summary(r), pending, audit: own };
  });
}

/** The email or SMS as the outside person gets it. ordy keeps only the link's hash, so the link ends in "…". */
function message(requester: string, expiresAt: Date, channel: RequestRow["channel"]): { subject: string | null; text: string } {
  const content = { requester, clinic: env.CLINIC_NAME, link: `${env.PUBLIC_URL}/r/…`, expiresAt };
  return channel === "email" ? requestEmail(content) : { subject: null, ...requestSms(content) };
}

/** What sending a link uses. Tests swap these for stand-ins, so they send nothing and post nothing in Matrix. */
export const linkDeps = { readPatient: readFhirPatient, sendRequestEmail, sendRequestSms, notify: notifyRequest };

const MailFailure = z.object({ code: z.string().optional(), responseCode: z.number().optional(), cause: z.object({ code: z.string() }).optional() });

/** Codes only. Nodemailer puts the SMTP server's response in the message, and the response can echo an address or a name. */
function notSentReason(error: unknown): string {
  if (error instanceof MessageRefused) return `refused for ${error.categories.join(", ")}`;
  if (error instanceof NoSmsGateway) return "no SMS gateway in this build";
  if (error instanceof IncompletePatient) return "refused for an incomplete patient record";
  if (error instanceof FhirError) return `the FHIR server answered ${error.status}`;
  const failure = MailFailure.catch({}).parse(error);
  const code = failure.code ?? failure.cause?.code ?? "no code";
  return failure.responseCode ? `${code}, SMTP ${failure.responseCode}` : code;
}

/**
 * Sends the link by email, or by SMS into the demo outbox (`sendRequestSms`), inside the transaction `tx` that stores the
 * request as sent. Both run the content check first. Never logs the link: it holds the token.
 */
async function sendLink(tx: Tx, request: RequestRow, token: string) {
  const link = `${env.PUBLIC_URL}/r/${token}`;
  const patient = await linkDeps.readPatient(request.patientId).catch((error: unknown) => notSent(request, "reading the patient", error));
  const content = { to: request.address, requester: request.requesterName, clinic: env.CLINIC_NAME, link, expiresAt: request.expiresAt, patient };
  const sent = request.channel === "sms" ? linkDeps.sendRequestSms(tx, { requestId: request.id, ...content }) : linkDeps.sendRequestEmail(content);
  await sent.catch((error: unknown) => notSent(request, "sending", error));
}

function notSent(request: RequestRow, stage: string, error: unknown): never {
  const kind = request.channel === "sms" ? "SMS" : "email";
  console.error(`The ${kind} for request ${request.id} was not sent while ${stage}: ${notSentReason(error)}`);
  if (error instanceof NoSmsGateway) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This installation has no SMS gateway, so ordy cannot send an SMS. Send the request by email. The request did not go out.",
    });
  }
  if (error instanceof MessageRefused) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `The ${kind} would contain ${error.categories.join(", ")}, so it was not sent. The request did not go out.` });
  }
  if (error instanceof IncompletePatient) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `The patient's record on the FHIR server lacks a given name, a family name, or a full birth date, so ordy cannot check the ${kind}. The request did not go out.`,
    });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `The ${kind} could not be sent. The request did not go out; try again in a few minutes.` });
}

/**
 * The "Request … sent" notice in Dr. Hofer's room, after the request is stored as sent. It starts the request's thread:
 * `notifyRequest` stores its room and event id in `matrix_room` and `matrix_event`. It never throws, so a failed notice
 * leaves the sent request as it is. Names the requested person and organisation, never the patient.
 */
const sentNotice = (request: RequestRow) =>
  linkDeps.notify(request, { kind: "sent", requestId: request.id, recipient: `${request.given} ${request.family}`, org: request.org, channel: request.channel });

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
    if (request.state === "sent") await sentNotice(request);
    return { ...summary(request), addressWarning: check.result === "pass" ? null : addressWarning(check, input.org) };
  }),

  get: ownRequestProcedure.query(async ({ ctx }) => {
    const [item] = await withPending(ctx.db, [ctx.request]);
    return { ...item, message: message(ctx.request.requesterName, ctx.request.expiresAt, ctx.request.channel) };
  }),

  list: clinicProcedure.query(async ({ ctx }) => withPending(ctx.db, await listRequests(ctx.db, ctx.actor.mxid))),

  /** The email or SMS a new request would send, with the content check for the patient run on it. */
  preview: clinicProcedure
    .input(z.object({ channel: z.enum(["email", "sms"]), patient: patientId }))
    .query(async ({ ctx, input }) => {
      const [patient, requester] = await Promise.all([
        readFhirPatient(input.patient).catch((error: unknown) => {
          if (error instanceof FhirError && error.status === 404) throw new TRPCError({ code: "NOT_FOUND", message: `Patient ${input.patient} does not exist` });
          throw error;
        }),
        displayName(ctx.actor.mxid),
      ]);
      const shown = message(requester ?? ctx.actor.mxid, new Date(Date.now() + LINK_TTL_MS), input.channel);
      return { ...shown, refused: forbiddenContent({ subject: shown.subject ?? "", text: shown.text }, patient) };
    }),

  /**
   * What the eHVD and the bindings say about a recipient while Dr. Hofer types. Advisory and read only: the address check
   * in `create` still decides, and writes `misdelivery_caught`.
   */
  checkRecipient: clinicProcedure
    .input(
      z.object({
        given: z.string().trim().max(128),
        family: z.string().trim().max(128),
        org: z.string().trim().min(1).max(128),
        channel: z.enum(["email", "sms"]),
        address: z.string().trim().max(254),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [check, binding] = await Promise.all([checkRecipient(input), findBinding(ctx.db, input)]);
      return { ...check, knownSender: binding !== null };
    }),

  /** Dr. Hofer confirms the address after the warning. The request goes out with a new 7-day link. */
  sendAnyway: ownRequestProcedure.mutation(async ({ ctx }) => {
    const sent = await sendAnyway(ctx.db, ctx.request.id, auditActor(ctx.actor), sendLink).catch(conflict);
    if (!sent) throw notFound(ctx.request.id);
    await sentNotice(sent.request);
    return summary(sent.request);
  }),

  accept: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "accept"))),

  reject: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "reject"))),

  cancel: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "cancel"))),
});
