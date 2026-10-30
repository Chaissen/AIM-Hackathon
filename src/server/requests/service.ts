import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";

import type { DocumentType } from "@/lib/document-types";
import { type AuditActor, type AuditEntry, recordAudit } from "@/server/audit/record";
import type { Db, Tx } from "@/server/db";
import { bindings, requests } from "@/server/db/schema";
import type { LoginTransition } from "@/server/identity/login";
import { initialState, OPEN_STATES, type RequestEvent, transition } from "./lifecycle";
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
 * Returns the ids it expired.
 */
export async function expireDueRequests(db: Db | Tx, id?: number): Promise<number[]> {
  const expired = await db
    .update(requests)
    .set({ state: "expired" })
    .where(and(inArray(requests.state, OPEN_STATES), lte(requests.expiresAt, new Date()), id === undefined ? undefined : eq(requests.id, id)))
    .returning({ id: requests.id });
  return expired.map((r) => r.id);
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

/**
 * Applies a lifecycle event and stores the new state: Dr. Hofer's decisions and the answer. A login goes through
 * `applyLoginTransition` below. Locks the row, so two events on one request run one after the other.
 * Returns null for an unknown request and throws a TransitionError if the state does not accept the event.
 *
 * `then` runs in the same transaction with the updated request: write the audit entry that belongs to the change there,
 * so the state and the log never disagree. It may update more columns and return the request it read back.
 */
export async function applyEvent(
  db: Db,
  id: number,
  event: RequestEvent,
  then?: (tx: Tx, request: RequestRow) => Promise<RequestRow | void>,
): Promise<RequestRow | null> {
  return db.transaction(async (tx) => {
    await expireDueRequests(tx, id);
    const [row] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
    if (!row) return null;
    const state = transition(row.state, event, row.failedChecks);
    const [updated] = await tx.update(requests).set({ state }).where(eq(requests.id, id)).returning();
    return (await then?.(tx, updated)) ?? updated;
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
    if (transition(row.state, LOGIN_EVENT[change.to], row.failedChecks) !== change.to) return false;
    await tx
      .update(requests)
      .set({ state: change.to, ...("personNumber" in change ? { personNumber: change.personNumber } : {}) })
      .where(eq(requests.id, id));
    return true;
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
