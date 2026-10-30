import { createHmac } from "node:crypto";

import { env } from "@/env";
import type { DocumentType } from "@/lib/document-types";
import type { Actor } from "@/server/api/trpc";
import { sessionSecret } from "@/server/auth/session-secret";
import type { CheckResult, Verdict } from "@/server/identity/checks";
import type { Db, Tx } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import type { AnswerFiled } from "@/server/fhir/file-answer";
import type { RequestState } from "@/server/requests/lifecycle";

// The six audit events with who, what, and when. docs/ARCHITECTURE.md, "Audit log".
// Each event has its own outcome and detail fields: ids, hashes, and check results. Never document text or patient data.

export type AuditEvent = (typeof auditLog.$inferInsert)["event"];
export type AuditActor = { kind: (typeof auditLog.$inferInsert)["actorKind"]; id: string };
// One identity check as `identity_checked` stores it: the check names and reason codes from src/server/identity/checks.ts.
export type IdentityCheck = { check: CheckResult["check"]; result: Verdict; reason: CheckResult["reason"] };

type Entries = {
  request_sent: { outcome: "sent"; detail: { docType: DocumentType; channel: "email" | "sms"; address: string } };
  link_opened: { outcome: "shown" | "refused"; detail: { state: RequestState } };
  identity_checked: { outcome: Verdict; detail: { checks: IdentityCheck[] } };
  answer_sent: { outcome: "received"; detail: { sha256: string; size: number } };
  // The ids from the filing (T13). `acceptedBy` is the network member who accepted a held answer; `at` says when.
  answer_filed: { outcome: "filed"; detail: AnswerFiled & { acceptedBy?: string } };
  misdelivery_caught:
    | { outcome: "address_mismatch"; detail: { domain: string; expectedDomain: string } }
    // The actor already names the person who failed.
    | { outcome: "wrong_person"; detail: { checks: IdentityCheck[] } }
    // Only the upload's hash and which part did not match. The upload itself is discarded.
    | { outcome: "patient_mismatch"; detail: { sha256: string; size: number; nameMatches: boolean; birthDateMatches: boolean } };
};

export type MisdeliveryReason = Entries["misdelivery_caught"]["outcome"];

export type AuditEntry = {
  [E in AuditEvent]: { event: E; requestId: number | null; actor: AuditActor } & Entries[E];
}[AuditEvent];

/** Writes one audit entry. Pass the transaction when the entry belongs to a state change. */
export async function recordAudit(db: Db | Tx, entry: AuditEntry) {
  const [row] = await db
    .insert(auditLog)
    .values({
      event: entry.event,
      requestId: entry.requestId,
      actorKind: entry.actor.kind,
      actor: entry.actor.id,
      outcome: entry.outcome,
      detail: entry.detail,
    })
    .returning();
  return row;
}

export const SERVICE_ACTOR: AuditActor = { kind: "service", id: "ordy" };

/** The audit actor for a tRPC caller. */
export function auditActor(actor: Actor): AuditActor {
  switch (actor.kind) {
    case "clinic":
      return { kind: "network_member", id: actor.mxid };
    case "eid":
      return { kind: "outside_person", id: `${actor.session.givenName} ${actor.session.familyName} (${actor.session.personNumber})` };
    case "anonymous":
      return { kind: "anonymous", id: "anonymous" };
  }
}

/**
 * An anonymous browser, named by a keyed hash of its IP address. A plain SHA-256 of an IPv4 address can be reversed
 * by trying all of them, so the hash needs a private key. The key is derived from ORDY_SECRET, so an IP hash never
 * equals an HMAC made with the session cookie key. Without a private ORDY_SECRET the address is not recorded at all.
 */
export function anonymousBrowser(ip: string | null): AuditActor {
  const secret = sessionSecret.safeParse(env.ORDY_SECRET);
  if (!ip || !secret.success) return { kind: "anonymous", id: "ip unknown" };
  const key = createHmac("sha256", secret.data).update("ordy/ip-hash/v1").digest();
  return { kind: "anonymous", id: `ip ${createHmac("sha256", key).update(ip).digest("hex").slice(0, 16)}` };
}
