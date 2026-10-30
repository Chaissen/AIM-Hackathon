import { TRPCError } from "@trpc/server";
import { asc, inArray } from "drizzle-orm";
import { z } from "zod";

import { env } from "@/env";
import { requestInput } from "@/lib/request-input";
import { type Actor, clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { answerDeps } from "@/server/answers/deps";
import { logReason } from "@/server/answers/file";
import { acceptAnswer, FilingOutcomeOpen, NoHeldAnswer, rejectAnswer } from "@/server/answers/held";
import { auditActor, recordAudit } from "@/server/audit/record";
import type { Db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { nameWords } from "@/server/identity/names";
import { displayName } from "@/server/matrix/client";
import { taskStatus, TransitionError } from "@/server/requests/lifecycle";
import { applyEvent, createRequest, getRequest, listRequests, type RequestRow, sendAnyway } from "@/server/requests/service";

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

// TODO(T06): send the link by email or SMS. Until then, print it in development so the portal can be tried.
function printLink(request: RequestRow, token: string) {
  if (env.NODE_ENV === "development") console.info(`Request ${request.id}: ${env.PUBLIC_URL}/r/${token}`);
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
      { passed: true },
    );
    if (request.state === "sent") printLink(request, token);
    return summary(request);
  }),

  get: ownRequestProcedure.query(async ({ ctx }) => ({ ...summary(ctx.request), audit: await auditOf(ctx.db, [ctx.request.id]) })),

  list: clinicProcedure.query(async ({ ctx }) => {
    const listed = await listRequests(ctx.db, ctx.actor.mxid);
    const audit = await auditOf(ctx.db, listed.map((r) => r.id));
    return listed.map((r) => ({ ...summary(r), audit: audit.filter((a) => a.requestId === r.id) }));
  }),

  sendAnyway: ownRequestProcedure.mutation(async ({ ctx }) => {
    const sent = await sendAnyway(ctx.db, ctx.request.id, auditActor(ctx.actor)).catch(conflict);
    if (!sent) throw notFound(ctx.request.id);
    printLink(sent.request, sent.token);
    return summary(sent.request);
  }),

  accept: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "accept"))),

  reject: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "reject"))),

  cancel: ownRequestProcedure.mutation(async ({ ctx }) => summary(await decide(ctx, "cancel"))),
});
