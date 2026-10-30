import { z } from "zod";

import { addressWarning } from "@/lib/address-check";
import { outsidePersonName } from "@/lib/audit-actor";
import type { auditLog, HeldAnswerSender, requests } from "@/server/db/schema";

type AuditRow = typeof auditLog.$inferSelect;
type RequestRow = typeof requests.$inferSelect;

export type IdentityHoldReason = "partial_name" | "requested_name_empty" | "ehvd_unreachable" | "unknown";

export type PendingDecision =
  /** Send anyway or Cancel. `mismatch` is null when the eHVD could not confirm the address. */
  | { kind: "address"; warning: string; mismatch: { domain: string; expectedDomain: string } | null }
  /** Accept or Reject the person who logged in. `person` is null when the audit log has no hold with a person. */
  | { kind: "identity"; person: string | null; requested: string; reason: IdentityHoldReason }
  /** Accept files the held answer, Reject drops it. `filingOpen`: the last Accept may have filed it, so only Accept again ends it. */
  | { kind: "answer"; sender: string; reason: string; sentAt: Date; filingOpen: boolean };

type HeldAnswerSummary = { sender: HeldAnswerSender; reason: string; sentAt: Date };

const mismatch = z.object({ domain: z.string(), expectedDomain: z.string() });
const checks = z.object({ checks: z.array(z.object({ check: z.string(), result: z.string(), reason: z.string() })) });

function firstHeldCheckReason(detail: unknown): IdentityHoldReason {
  const held = checks.safeParse(detail).data?.checks.find((c) => c.result === "hold");
  if (held?.check === "name" && held.reason === "partial") return "partial_name";
  if (held?.check === "name" && held.reason === "requested_name_empty") return "requested_name_empty";
  if (held?.check === "service" && held.reason === "ehvd_unreachable") return "ehvd_unreachable";
  return "unknown";
}

const chronological = (audit: readonly AuditRow[]) => [...audit].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);

/**
 * The decision an open request waits for, or null. `held` is the request's `held_answers` row without its text, and
 * `kept` says whether a `kept_answers` row exists.
 */
export function pendingDecision(
  request: Pick<RequestRow, "state" | "given" | "family" | "org" | "personNumber">,
  audit: readonly AuditRow[],
  held: HeldAnswerSummary | null,
  kept: boolean,
): PendingDecision | null {
  switch (request.state) {
    case "awaiting_confirmation": {
      const caught = mismatch.safeParse(audit.find((a) => a.event === "misdelivery_caught" && a.outcome === "address_mismatch")?.detail);
      if (!caught.success) return { kind: "address", warning: "The eHVD could not confirm the address, so the request has not been sent.", mismatch: null };
      const warning = addressWarning({ result: "mismatch", ...caught.data }, request.org);
      return { kind: "address", warning, mismatch: caught.data };
    }
    case "identity_held": {
      const hold = chronological(audit).find((a) =>
        a.event === "identity_checked" && a.outcome === "hold" && a.actorKind === "outside_person" &&
        request.personNumber !== null && a.actor.endsWith(` (${request.personNumber})`),
      );
      return {
        kind: "identity",
        person: hold ? outsidePersonName(hold.actor) : null,
        requested: `${request.given} ${request.family}`,
        reason: hold ? firstHeldCheckReason(hold.detail) : "unknown",
      };
    }
    case "answer_held":
      if (!held) return null;
      return { kind: "answer", sender: `${held.sender.givenName} ${held.sender.familyName}`, reason: held.reason, sentAt: held.sentAt, filingOpen: kept };
    case "sent":
    case "verified":
    case "filed":
    case "cancelled":
    case "expired":
    case "locked":
      return null;
    default:
      return request.state satisfies never;
  }
}
