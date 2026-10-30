import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import type { DocumentType } from "@/lib/document-types";
import { type AuditActor, type AuditEntry, recordAudit } from "@/server/audit/record";
import type { Db, Tx } from "@/server/db";
import { bindings, heldAnswers, keptAnswers, requests } from "@/server/db/schema";
import type { LoginTransition } from "@/server/identity/login";
import { initialState, isOpen, MAX_FAILED_CHECKS, OPEN_STATES, type RequestEvent, transition, TransitionError } from "./lifecycle";
import { hashLinkToken, isLinkToken, LINK_TTL_MS, newLinkToken } from "./link-token";

// Reads and state changes of requests. Every caller goes through here: the tRPC router, the portal pages, and later the login and filing.

export type RequestRow = typeof requests.$inferSelect;

export type NewRequest = {
  docType: DocumentType;
  patientId: string;
  given: string;
  family: string;
  org: string;
  channel: "email" | "sms";
  address: string;
  /** Matrix ID of the network member who sends the request. */
  requester: string;
  requesterName: string;
};

const requestSent = (request: RequestRow, actor: AuditActor): AuditEntry => ({
  event: "request_sent",
  requestId: request.id,
  actor,
  outcome: "sent",
  detail: { docType: request.docType, channel: request.channel, address: request.address },
});

const newExpiry = () => new Date(Date.now() + LINK_TTL_MS);

/** The result of the address check (T15): the email domain against the organisation's domain in the eHVD. */
export type AddressCheck = { passed: true } | { passed: false; domain: string; expectedDomain: string };

/**
 * Stores a new request, with its audit entry in the same transaction. If the address check passed, the request is
 * `sent` with `request_sent`. Otherwise it waits in `awaiting_confirmation` with `misdelivery_caught: address_mismatch`.
 * Returns the link token, which exists only here: the database keeps its hash.
 */
export async function createRequest(db: Db, input: NewRequest, addressCheck: AddressCheck) {
  const { token, hash } = newLinkToken();
  const state = initialState(addressCheck.passed);
  const request = await db.transaction(async (tx) => {
    const [row] = await tx.insert(requests).values({ ...input, state, linkHash: hash, expiresAt: newExpiry() }).returning();
    const actor: AuditActor = { kind: "network_member", id: row.requester };
    await recordAudit(
      tx,
      addressCheck.passed
        ? requestSent(row, actor)
        : {
            event: "misdelivery_caught",
            requestId: row.id,
            actor,
            outcome: "address_mismatch",
            detail: { domain: addressCheck.domain, expectedDomain: addressCheck.expectedDomain },
          },
    );
    return row;
  });
  return { request, token };
}

/**
 * Dr. Hofer clicked Send anyway after the address warning. The request goes out now: it gets a new link token, valid
 * for 7 days from now, and `request_sent` is logged. Returns the new token, or null for an unknown request.
 */
export async function sendAnyway(db: Db, id: number, actor: AuditActor) {
  const { token, hash } = newLinkToken();
  const request = await applyEvent(db, id, "send_anyway", async (tx) => {
    const [row] = await tx.update(requests).set({ linkHash: hash, expiresAt: newExpiry() }).where(eq(requests.id, id)).returning();
    await recordAudit(tx, requestSent(row, actor));
    return row;
  });
  return request && { request, token };
}

/**
 * Sets open requests past their expiry to `expired` ("7 days pass" in the lifecycle): the one with `id`, or all of them.
 * No job runs for this; every read below calls it first, so nobody sees an open request that has expired.
 * Returns the ids it expired. Inside a transaction that rolls back, the expiry rolls back too, and the next read redoes it.
 */
export async function expireDueRequests(db: Db | Tx, id?: number): Promise<number[]> {
  const expired = await db
    .update(requests)
    // The ID token has done its work once the request is closed: a filed answer carries it in the Provenance.
    .set({ state: "expired", idToken: null })
    .where(and(inArray(requests.state, OPEN_STATES), lte(requests.expiresAt, new Date()), id === undefined ? undefined : eq(requests.id, id)))
    .returning({ id: requests.id });
  const ids = expired.map((r) => r.id);
  if (ids.length) {
    await db.delete(heldAnswers).where(inArray(heldAnswers.requestId, ids));
    await db.delete(keptAnswers).where(inArray(keptAnswers.requestId, ids));
  }
  return ids;
}

export async function getRequest(db: Db, id: number): Promise<RequestRow | null> {
  await expireDueRequests(db, id);
  const [row] = await db.select().from(requests).where(eq(requests.id, id));
  return row ?? null;
}

/** The request behind a link token, in any state. Null for an unknown or malformed token. */
export async function findRequestByToken(db: Db, token: string): Promise<RequestRow | null> {
  if (!isLinkToken(token)) return null;
  const hash = hashLinkToken(token);
  const [found] = await db.select({ id: requests.id }).from(requests).where(eq(requests.linkHash, hash));
  return found ? getRequest(db, found.id) : null;
}

export async function saveIdToken(db: Db, id: number, idToken: string): Promise<void> {
  await db.update(requests).set({ idToken }).where(eq(requests.id, id));
}

/** The requests one network member sent, newest first. */
export async function listRequests(db: Db, requester: string, limit = 100): Promise<RequestRow[]> {
  await expireDueRequests(db);
  return db
    .select()
    .from(requests)
    .where(eq(requests.requester, requester))
    .orderBy(desc(requests.createdAt), desc(requests.id))
    .limit(limit);
}

/** Every lifecycle event but a login's. Only `applyLoginTransition` applies those, so a login always stores the bPK. */
export type NonLoginEvent = Exclude<RequestEvent, (typeof LOGIN_EVENT)[keyof typeof LOGIN_EVENT]>;

/**
 * Applies a lifecycle event and stores the new state: Dr. Hofer's decisions and the answer. A login goes through
 * `applyLoginTransition` below. Locks the row, so two events on one request run one after the other.
 * Returns null for an unknown request and throws a TransitionError if the state does not accept the event.
 *
 * `then` runs in the same transaction with the updated request: write the audit entry that belongs to the change there,
 * so the state and the log never disagree. It may update more columns and return the request it read back. Inside a
 * transaction (`db` is a Tx), the event runs in a savepoint, so a failed event leaves the outer transaction usable.
 */
export async function applyEvent(
  db: Db | Tx,
  id: number,
  event: NonLoginEvent,
  then?: (tx: Tx, request: RequestRow) => Promise<RequestRow | void>,
): Promise<RequestRow | null> {
  return db.transaction(async (tx) => {
    await expireDueRequests(tx, id);
    const [row] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
    if (!row) return null;
    // The type already refuses a login's event; this holds for a caller that casts too.
    if ((Object.values(LOGIN_EVENT) as RequestEvent[]).includes(event)) throw new TransitionError(row.state, event);
    const state = transition(row.state, event, row.failedChecks);
    const [updated] = await tx.update(requests).set({ state }).where(eq(requests.id, id)).returning();
    const result = (await then?.(tx, updated)) ?? updated;
    // A held answer lives only while the request is `answer_held`: Accept files it, Reject, Cancel, and expiry drop it.
    // A kept answer lives while an upload or an Accept may still file it: filing ends that, and so do Cancel and expiry.
    if (state !== "answer_held") await tx.delete(heldAnswers).where(eq(heldAnswers.requestId, id));
    if (state !== "verified" && state !== "answer_held") await tx.delete(keptAnswers).where(eq(keptAnswers.requestId, id));
    // A closed request needs no ID token any more; a filed answer carries it in the Provenance.
    if (!isOpen(state)) {
      await tx.update(requests).set({ idToken: null }).where(eq(requests.id, id));
      return { ...result, idToken: null };
    }
    return result;
  });
}

// The request service side of the identity check ports (docs/IDENTITY.md, "Identity checks"). identity-ports.ts wires them.

/** Adds one failed identity check in one statement and returns the new count. The lock follows from it. */
export async function incrementFailedChecks(db: Db, id: number): Promise<number> {
  const [row] = await db
    .update(requests)
    .set({ failedChecks: sql`${requests.failedChecks} + 1` })
    .where(eq(requests.id, id))
    .returning({ failedChecks: requests.failedChecks });
  if (!row) throw new Error(`Request ${id} does not exist`);
  return row.failedChecks;
}

const LOGIN_EVENT = { verified: "identity_pass", identity_held: "identity_hold", locked: "identity_fail" } as const satisfies Record<
  LoginTransition["to"],
  RequestEvent
>;

/**
 * Applies a login's state change only while the request is still in `change.from` and not expired, and stores the bPK
 * in the same statement, so a request is bound to one person once and never rebound. Returns false when the state
 * changed in between or the lifecycle refuses the change, for example a lock before the third failed check.
 */
export async function applyLoginTransition(db: Db, id: number, change: LoginTransition): Promise<boolean> {
  return db.transaction(async (tx) => {
    await expireDueRequests(tx, id);
    const [row] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
    if (!row || row.state !== change.from) return false;
    // Three counted failures lock a sent request. If the lock after the third one never ran, this login locks it instead.
    const to = row.failedChecks >= MAX_FAILED_CHECKS ? "locked" : change.to;
    if (transition(row.state, LOGIN_EVENT[to], row.failedChecks) !== to) return false;
    await tx
      .update(requests)
      .set({ state: to, ...("personNumber" in change && to === change.to ? { personNumber: change.personNumber } : {}) })
      .where(eq(requests.id, id));
    return to === change.to;
  });
}

/** The bPK bound to this person at this organisation in `bindings`, or null. */
export async function findBinding(db: Db, key: { given: string; family: string; org: string }): Promise<string | null> {
  const [row] = await db
    .select({ personNumber: bindings.personNumber })
    .from(bindings)
    .where(and(eq(bindings.given, key.given), eq(bindings.family, key.family), eq(bindings.org, key.org)));
  return row?.personNumber ?? null;
}
