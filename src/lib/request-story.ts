import { z } from "zod";

import { outsidePersonName } from "@/lib/audit-actor";
import { CHECK_TEXT } from "@/lib/identity-check-text";
import type { IdentityCheck } from "@/server/audit/record";
import type { auditLog } from "@/server/db/schema";
import type { Verdict } from "@/server/identity/checks";
import { isOpen, REQUEST_STATES, type RequestState } from "@/server/requests/lifecycle";

// A request's audit entries as Dr. Hofer reads them: the history, the five progress steps, and each login's checks.
// `detail` is jsonb, so every field read here goes through zod first.

type AuditRow = typeof auditLog.$inferSelect;

export type Tone = "pass" | "hold" | "fail" | "none";
export type HistoryLine = { id: number; at: Date; text: string; tone: Tone };

type StepKey = "sent" | "opened" | "confirmed" | "answered" | "received";
export type StepStatus = "done" | "current" | "held" | "blocked" | "todo";
/** `at` is when the step was done, when the audit log says so. */
export type ProgressStep = { key: StepKey; label: string; status: StepStatus; at: Date | null; note: string | null };

export type IdentityAttempt = { id: number; at: Date; person: string | null; verdict: Verdict; checks: IdentityCheck[] };

const verdict = z.enum(["pass", "hold", "fail"]);
const identityCheck = z
  .object({
    check: z.custom<IdentityCheck["check"]>((value) => typeof value === "string" && Object.hasOwn(CHECK_TEXT, value)),
    result: verdict,
    reason: z.custom<IdentityCheck["reason"]>((value) => typeof value === "string"),
  })
  .refine((c) => Object.hasOwn(CHECK_TEXT[c.check], c.reason));
const sentDetail = z.object({ sentAnyway: z.boolean().optional() });
const filedDetail = z.object({ acceptedBy: z.string().optional() });
const domains = z.object({ domain: z.string(), expectedDomain: z.string() });
const decision = z.object({ from: z.enum(REQUEST_STATES) });
const upload = z.object({ sha256: z.string() });
const heldChecks = z.object({ checks: z.array(z.object({ check: z.string(), result: z.string(), reason: z.string() })) });

/** A hold whose checks include the partial name match, the hold a doctor sees most. */
const partialName = (detail: unknown) =>
  heldChecks.safeParse(detail).data?.checks.some((c) => c.check === "name" && c.result === "hold" && c.reason === "partial") ?? false;

const chronological = (audit: readonly AuditRow[]) => [...audit].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);

const isStoppedUpload = (row: AuditRow) => row.event === "misdelivery_caught" && row.outcome === "patient_mismatch";

/** Uploads the patient check stopped: `misdelivery_caught` with `patient_mismatch`. */
export const stoppedUploads = (audit: readonly AuditRow[]) => audit.filter(isStoppedUpload).length;

export function lastActivity(request: { createdAt: Date; audit: readonly AuditRow[] }): Date {
  return request.audit.reduce((latest, row) => (row.at > latest ? row.at : latest), request.createdAt);
}

type StoryRequest = { channel: "email" | "sms"; address: string; org: string };

const unreadable = (row: AuditRow) => ({ text: `Unreadable audit entry: ${row.event}, ${row.outcome}`, tone: "none" as const });

function describe(row: AuditRow, request: StoryRequest): { text: string; tone: Tone } {
  const name = outsidePersonName(row.actor);
  const person = name ?? "Someone";
  switch (row.event) {
    case "request_sent": {
      const channel = request.channel === "email" ? "email" : "text message";
      const confirmed = sentDetail.safeParse(row.detail).data?.sentAnyway ? " after you confirmed the address" : "";
      return { text: `Sent by ${channel} to ${request.address}${confirmed}`, tone: "pass" };
    }
    case "link_opened":
      if (row.outcome === "shown") return { text: "Someone opened the link", tone: "none" };
      if (row.outcome === "refused") return { text: "Someone opened the link after it stopped working", tone: "none" };
      return unreadable(row);
    case "identity_checked":
      if (row.outcome === "pass") return { text: `${person} confirmed who they are with ID Austria`, tone: "pass" };
      // Without a login there is no person: Keycloak could not be reached.
      if (row.outcome === "hold" && name === null) return { text: "A login could not be finished, because ID Austria could not be reached", tone: "hold" };
      if (row.outcome === "hold" && partialName(row.detail)) return { text: `${person} logged in, but the name only partly matches`, tone: "hold" };
      if (row.outcome === "hold") return { text: `${person} logged in and needs your check`, tone: "hold" };
      if (row.outcome === "fail") return { text: `${person} logged in and was turned away`, tone: "fail" };
      return unreadable(row);
    case "answer_sent":
      return { text: `${person} sent a document`, tone: "none" };
    case "answer_filed":
      return filedDetail.safeParse(row.detail).data?.acceptedBy
        ? { text: "Added to the patient record after you accepted it", tone: "pass" }
        : { text: "Added to the patient record", tone: "pass" };
    case "misdelivery_caught": {
      if (row.outcome === "address_mismatch") {
        const mismatch = domains.safeParse(row.detail).data;
        if (mismatch) return { text: `Held back. The address domain ${mismatch.domain} does not belong to ${request.org}.`, tone: "hold" };
      }
      if (row.outcome === "wrong_person") return { text: `Blocked. ${person} is not the person you asked for.`, tone: "fail" };
      if (row.outcome === "patient_mismatch") return { text: "Blocked. The document was about a different patient. Nothing was saved.", tone: "fail" };
      return unreadable(row);
    }
    case "request_decided": {
      if (row.outcome === "cancelled") return { text: "You cancelled the request", tone: "none" };
      const from = decision.safeParse(row.detail).data?.from;
      const decided = from === "identity_held" ? "the sender" : from === "answer_held" ? "the document" : null;
      if (from === "identity_held" && row.outcome === "accepted") return { text: "You confirmed the sender", tone: "pass" };
      if (decided && row.outcome === "accepted") return { text: `You accepted ${decided}`, tone: "pass" };
      if (decided && row.outcome === "rejected") return { text: `You rejected ${decided}`, tone: "none" };
      return unreadable(row);
    }
    default:
      return row.event satisfies never;
  }
}

// login.ts writes a failed check and its `wrong_person` back to back with the same actor. The history shows one line.
const mergedIntoNext = (row: AuditRow, next: AuditRow | undefined) =>
  row.event === "identity_checked" &&
  row.outcome === "fail" &&
  next?.event === "misdelivery_caught" &&
  next.outcome === "wrong_person" &&
  next.actor === row.actor;

/** The request's history, newest first. */
export function historyOf(request: StoryRequest, audit: readonly AuditRow[]): HistoryLine[] {
  const rows = chronological(audit);
  return rows
    .filter((row, i) => !mergedIntoNext(row, rows[i + 1]))
    .map((row) => ({ id: row.id, at: row.at, ...describe(row, request) }))
    .reverse();
}

const STEPS = [
  ["sent", "Sent"],
  ["opened", "Opened"],
  ["confirmed", "Sender confirmed"],
  ["answered", "Answered"],
  ["received", "Received"],
] as const satisfies readonly (readonly [StepKey, string])[];

/** What the audit log and the state say about one step. Null status: not reached yet. */
type Found = { status: "done" | "held" | "blocked" | null; at: Date | null; note: string | null };

const count = (n: number, one: string, many: string) => (n === 0 ? null : `${n} ${n === 1 ? one : many}`);

function found(state: RequestState, rows: AuditRow[]): Record<StepKey, Found> {
  const firstAt = (match: (row: AuditRow) => boolean, from = 0) => rows.slice(from).find(match)?.at ?? null;
  const sent = rows.findIndex((row) => row.event === "request_sent");
  const stopped = new Set(rows.filter(isStoppedUpload).map((row) => upload.safeParse(row.detail).data?.sha256));

  const openedAt =
    sent < 0 ? null : firstAt((row) => row.event === "link_opened" && row.outcome === "shown", sent + 1);
  const confirmedAt =
    firstAt((row) => row.event === "identity_checked" && row.outcome === "pass") ??
    firstAt((row) => row.event === "request_decided" && row.outcome === "accepted" && decision.safeParse(row.detail).data?.from === "identity_held");
  const answeredAt = firstAt((row) => {
    const sha256 = row.event === "answer_sent" ? upload.safeParse(row.detail).data?.sha256 : undefined;
    return sha256 !== undefined && !stopped.has(sha256);
  });
  const logins = count(rows.filter((row) => row.event === "identity_checked" && row.outcome === "fail").length, "login turned away", "logins turned away");
  const uploads = count(stoppedUploads(rows), "upload stopped", "uploads stopped");

  const done = (at: Date | null, note: string | null = null): Found => ({ status: "done", at, note });
  const not = (status: Found["status"], note: string | null = null): Found => ({ status, at: null, note });
  const bound = state === "verified" || state === "answer_held" || state === "filed";

  return {
    sent: state === "awaiting_confirmation" ? not("held") : sent >= 0 ? done(rows[sent].at) : not(null),
    opened: openedAt ? done(openedAt) : not(null),
    confirmed:
      state === "locked"
        ? not("blocked", logins)
        : state === "identity_held"
          ? not("held", logins)
          : confirmedAt || bound
            ? done(confirmedAt, logins)
            : not(null, logins),
    answered: answeredAt || state === "answer_held" || state === "filed" ? done(answeredAt, uploads) : not(null, uploads),
    received: state === "answer_held" ? not("held") : state === "filed" ? done(firstAt((row) => row.event === "answer_filed")) : not(null),
  };
}

/**
 * Always five steps. The first step that is not done is `current` while the request is open, unless it is held or
 * blocked. Every other step not reached yet is `todo`.
 */
export function progressOf(state: RequestState, audit: readonly AuditRow[]): ProgressStep[] {
  const steps = found(state, chronological(audit));
  const active = STEPS.findIndex(([key]) => steps[key].status !== "done");
  return STEPS.map(([key, label], i) => {
    const { status, at, note } = steps[key];
    return { key, label, at, note, status: status ?? (i === active && isOpen(state) ? "current" : "todo") };
  });
}

/** Every login's identity checks, oldest first. A check this version does not know is left out. */
export function identityAttempts(audit: readonly AuditRow[]): IdentityAttempt[] {
  return chronological(audit).flatMap((row) => {
    const outcome = verdict.safeParse(row.outcome);
    if (row.event !== "identity_checked" || !outcome.success) return [];
    const listed: unknown[] = Array.isArray(row.detail.checks) ? row.detail.checks : [];
    const checks = listed.flatMap((check) => identityCheck.safeParse(check).data ?? []);
    return [{ id: row.id, at: row.at, person: outsidePersonName(row.actor), verdict: outcome.data, checks }];
  });
}
