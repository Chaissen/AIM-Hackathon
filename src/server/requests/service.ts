import { and, desc, eq, inArray, lte } from "drizzle-orm";

import type { DocumentType } from "@/lib/document-types";
import { type AuditActor, type AuditEntry, recordAudit } from "@/server/audit/record";
import type { Db, Tx } from "@/server/db";
import { requests } from "@/server/db/schema";
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

/**
 * Stores a new request. If the address check passed, the request is `sent` and `request_sent` goes into the audit log
 * in the same transaction. Returns the link token, which exists only here: the database keeps its hash.
 */
export async function createRequest(db: Db, input: NewRequest, { addressCheckPassed }: { addressCheckPassed: boolean }) {
  const { token, hash } = newLinkToken();
  const state = initialState(addressCheckPassed);
  const request = await db.transaction(async (tx) => {
    const [row] = await tx.insert(requests).values({ ...input, state, linkHash: hash, expiresAt: newExpiry() }).returning();
    if (state === "sent") await recordAudit(tx, requestSent(row, { kind: "network_member", id: row.requester }));
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

export async function listRequests(db: Db, limit = 100): Promise<RequestRow[]> {
  await expireDueRequests(db);
  return db.select().from(requests).orderBy(desc(requests.createdAt), desc(requests.id)).limit(limit);
}

/**
 * Applies a lifecycle event and stores the new state. Locks the row, so two events on one request run one after the other.
 * Returns null for an unknown request and throws a TransitionError if the state does not accept the event.
 * `identity_fail` also counts the failed check, and the third one locks the link.
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
    const failedChecks = row.failedChecks + (event === "identity_fail" ? 1 : 0);
    const state = transition(row.state, event, failedChecks);
    const [updated] = await tx.update(requests).set({ state, failedChecks }).where(eq(requests.id, id)).returning();
    return (await then?.(tx, updated)) ?? updated;
  });
}
