import type { auditLog } from "@/server/db/schema";
import type { Notice } from "@/server/matrix/notices";

import { checkIdentity, keycloakUnreachable, type CheckResult, type IdentityResult, type LoginIdentity } from "./checks";

// What follows from the identity checks at login, docs/IDENTITY.md ("Identity checks") and docs/ARCHITECTURE.md
// ("Request lifecycle"). `decideLogin` is pure. `runIdentityChecks` is the seam the callback (T07, #6) calls, with the
// request store and audit writer from the request core (T04, #3) passed in as ports.

/** Three failed identity checks lock the link. */
export const MAX_FAILED_CHECKS = 3;

export type AuditEntry = Omit<typeof auditLog.$inferInsert, "id" | "at">;

/** The states in which the link works for the outside person. In any other state the callback shows "This link does not work". */
export const LIVE_STATES = ["sent", "identity_held", "verified", "answer_held"] as const;
export type LiveState = (typeof LIVE_STATES)[number];
export type RequestState = LiveState | "awaiting_confirmation" | "filed" | "cancelled" | "expired" | "locked";

/** The request fields the checks need. `personNumber` is `requests.person_number`: the passed, held, or accepted person. */
export type CheckedRequest = { id: number; state: RequestState; given: string; family: string; org: string; personNumber: string | null };

/**
 * The only state changes a login makes. They are the identity rows of the lifecycle table, and all start from `sent`:
 * a login while Dr. Hofer decides, or after the request is verified, changes no state.
 */
export type LoginTransition =
  | { from: "sent"; to: "verified"; personNumber: string }
  | { from: "sent"; to: "identity_held"; personNumber: string }
  | { from: "sent"; to: "locked" };

/**
 * What the outside person sees. Only `answer` shows the patient and the document type.
 * - `held`: Dr. Hofer decides about this person or about the answer in the widget.
 * - `wrong_person`: "This request is for someone else. Nothing was shared with you."
 * - `unavailable`: ID Austria could not be reached, or the request changed during the login. Try again.
 * - `closed`: the link no longer works.
 */
export type LoginPage = "answer" | "held" | "wrong_person" | "unavailable" | "closed";

export type LoginDecision = {
  result: IdentityResult;
  /** The state change to try. A fail never has one here; the lock follows from `incrementFailedChecks`. */
  transition: LoginTransition | null;
  /** A fail adds one to `requests.failed_checks`. */
  countsTowardLock: boolean;
  page: LoginPage;
  audit: AuditEntry[];
  notice: Notice | null;
};

const fullName = (login: LoginIdentity) => `${login.givenName} ${login.familyName}`;

/** Only what the checks found, in the shape of `IdentityCheck` in the audit writer. Never the patient, never document text. */
const checkDetail = (checks: CheckResult[]) => ({ checks: checks.map(({ check, verdict, reason }) => ({ check, result: verdict, reason })) });

/**
 * The person a verified request is bound to: they passed, or Dr. Hofer accepted them. A held person is not accepted yet.
 * Undefined while the request is not bound. A bound request with a null person number still gives `{ personNumber: null }`,
 * so the request person check fails closed.
 */
export const boundPerson = (request: CheckedRequest) =>
  request.state === "verified" || request.state === "answer_held" ? { personNumber: request.personNumber } : undefined;

/**
 * Turns a check result into the state change, the audit entries, the page and the notice to Dr. Hofer.
 * `recipient` is how notices name the requested person, for example "Dr. Eva Brandl". `login` is null when Keycloak
 * could not be reached.
 */
export function decideLogin(
  request: CheckedRequest & { state: LiveState },
  recipient: string,
  login: LoginIdentity | null,
  result: IdentityResult,
): LoginDecision {
  const actor = login
    ? { actorKind: "outside_person" as const, actor: `${fullName(login)} (${login.personNumber ?? "no person number"})` }
    : { actorKind: "anonymous" as const, actor: "ID Austria login" };
  const checked: AuditEntry = { event: "identity_checked", requestId: request.id, ...actor, outcome: result.verdict, detail: checkDetail(result.checks) };
  const none = { transition: null, countsTowardLock: false, notice: null };

  if (result.verdict === "fail") {
    const failed = result.checks.filter((c) => c.verdict === "fail");
    return {
      result,
      transition: null,
      countsTowardLock: true,
      page: "wrong_person",
      audit: [checked, { event: "misdelivery_caught", requestId: request.id, ...actor, outcome: "wrong_person", detail: checkDetail(failed) }],
      notice: failNotice(request, recipient, login, failed),
    };
  }

  // A hold or a pass has a login with a person number: the person number check fails without one.
  const personNumber = login?.personNumber;
  if (!login || !personNumber) {
    // Without a login there is nobody for Dr. Hofer to accept. The state stays and the person tries again later.
    return { result, ...none, page: "unavailable", audit: [checked] };
  }

  if (result.verdict === "hold") {
    // Only the first hold on a sent request asks Dr. Hofer. Later holds change nothing and stay in the audit log.
    if (request.state !== "sent") return { result, ...none, page: "held", audit: [checked] };
    return {
      result,
      ...none,
      transition: { from: "sent", to: "identity_held", personNumber },
      page: "held",
      audit: [checked],
      notice: { kind: "held", requestId: request.id, hold: "identity", reason: holdReason(result.checks, recipient, login) },
    };
  }

  switch (request.state) {
    case "sent":
      return { result, ...none, transition: { from: "sent", to: "verified", personNumber }, page: "answer", audit: [checked] };
    case "verified":
      // The bound person logs in again, for example after the session expired.
      return { result, ...none, page: "answer", audit: [checked] };
    case "identity_held":
    case "answer_held":
      // Dr. Hofer decides first. A pass never skips her Accept.
      return { result, ...none, page: "held", audit: [checked] };
  }
}

/** The lock after a fail, from the count `incrementFailedChecks` returned. Only `sent → locked` is in the lifecycle table. */
export const lockTransition = (state: RequestState, failedChecks: number): LoginTransition | null =>
  state === "sent" && failedChecks >= MAX_FAILED_CHECKS ? { from: "sent", to: "locked" } : null;

/** A failed name means someone else opened the link. Any other fail may be the right person, so the notice says why. */
function failNotice(request: CheckedRequest, recipient: string, login: LoginIdentity | null, failed: CheckResult[]): Notice {
  const idAustriaName = login ? fullName(login) : "unknown";
  if (failed.some((c) => c.check === "name")) return { kind: "wrong-person", requestId: request.id, recipient, idAustriaName };
  return { kind: "identity-failed", requestId: request.id, idAustriaName, reason: failed.map((c) => failReason(c, recipient, request.org)).join(" ") };
}

function failReason(check: CheckResult, recipient: string, org: string): string {
  switch (check.check) {
    case "level":
      if (check.reason === "basic") return "The ID Austria login has only basic function, and a request needs full function.";
      if (check.reason === "missing") return "The login carries no ID Austria level, as with a foreign eID.";
      return "The login carries an unknown ID Austria level.";
    case "person_number":
      if (check.reason === "missing") return "The login carries no person number.";
      return `The person number differs from the one bound to ${recipient} at ${org}.`;
    case "ehvd_claim":
      return "The eHVD entry in the login could not be read.";
    case "request_person":
      if (check.reason === "unbound") return "The request stores no person number to compare with, so nobody can be confirmed.";
      return `Another person already logged in for this request as ${recipient}.`;
    default:
      return `The ${check.check} check failed.`;
  }
}

/** The reason sentence of a held notice, for example "The ID Austria name Petra Brandl matches Dr. Eva Brandl only in part." */
function holdReason(checks: CheckResult[], recipient: string, login: LoginIdentity): string {
  const sentences = checks
    .filter((c) => c.verdict === "hold")
    .map((c) => {
      if (c.check === "name" && c.reason === "requested_name_empty") return `The request has no usable name to compare with ${fullName(login)}.`;
      if (c.check === "name") return `The ID Austria name ${fullName(login)} matches ${recipient} only in part.`;
      if (c.check === "service" && c.reason === "ehvd_unreachable") return `The eHVD could not be reached to confirm ${fullName(login)}.`;
      return `The ${c.check} check could not be completed.`;
    });
  return sentences.join(" ");
}

/** What the identity checks need from the request core (T04, #3) and Dr. Hofer's room. */
export interface IdentityCheckPorts {
  /** The bound bPK in `bindings` for this given name, family name and organisation, or null. */
  findBinding(key: { given: string; family: string; org: string }): Promise<string | null>;
  /** Writes one audit entry (`recordAudit` from T04). */
  recordAudit(entry: AuditEntry): Promise<void>;
  /**
   * Adds one to `requests.failed_checks` atomically and returns the new count, for example
   * `UPDATE requests SET failed_checks = failed_checks + 1 WHERE id = $1 RETURNING failed_checks`, or the same under a
   * row lock. Never read the count and write it back: logins at the same time would all write 1 and none would lock.
   */
  incrementFailedChecks(requestId: number): Promise<number>;
  /**
   * Applies the change only if the request is still in `from`, for example
   * `UPDATE requests SET state = $to, person_number = $personNumber WHERE id = $1 AND state = $from`, and stores
   * `personNumber` in `requests.person_number` in the same statement. Returns false when the state changed in between.
   */
  transition(requestId: number, change: LoginTransition): Promise<boolean>;
  /** Posts the notice in the request's thread with `notifyRoom`. */
  notify(requestId: number, notice: Notice): Promise<void>;
}

export type LoginOutcome = { ok: true; login: LoginIdentity } | { ok: false; reason: "keycloak_unreachable" };

export type LoginRun = {
  /** Null when the link no longer works and no check ran. */
  result: IdentityResult | null;
  page: LoginPage;
  /** The change that was tried, and whether the request was still in `from`. */
  transition: LoginTransition | null;
  applied: boolean;
  /** The count after a fail, from `incrementFailedChecks`. Null when nothing was counted. */
  failedChecks: number | null;
  audit: AuditEntry[];
  /** The notice that was sent, or null. */
  notice: Notice | null;
};

const isLive = (state: RequestState): state is LiveState => (LIVE_STATES as readonly RequestState[]).includes(state);

/**
 * Runs the checks for one login and applies the decision. The callback calls it right after the ID token is verified
 * and the Keycloak session is ended, or with `keycloak_unreachable` when discovery or the code swap could not reach
 * Keycloak. A failed notice never changes what the person sees.
 */
export async function runIdentityChecks(
  ports: IdentityCheckPorts,
  request: CheckedRequest,
  recipient: string,
  outcome: LoginOutcome,
  unreachable: ReadonlyArray<"ehvd"> = [],
): Promise<LoginRun> {
  if (!isLive(request.state)) {
    return { result: null, page: "closed", transition: null, applied: false, failedChecks: null, audit: [], notice: null };
  }
  const live = { ...request, state: request.state };

  let decision: LoginDecision;
  if (outcome.ok) {
    const binding = await ports.findBinding({ given: request.given, family: request.family, org: request.org });
    const result = checkIdentity({ requested: request, login: outcome.login, binding, bound: boundPerson(request), unreachable });
    decision = decideLogin(live, recipient, outcome.login, result);
  } else {
    decision = decideLogin(live, recipient, null, keycloakUnreachable());
  }

  for (const entry of decision.audit) await ports.recordAudit(entry);

  let { transition, page, notice } = decision;
  let failedChecks: number | null = null;
  if (decision.countsTowardLock) {
    failedChecks = await ports.incrementFailedChecks(request.id);
    transition = lockTransition(request.state, failedChecks);
  }

  let applied = false;
  if (transition) {
    applied = await ports.transition(request.id, transition);
    if (!applied) {
      // Another login or Dr. Hofer changed the request in between. Show nothing; the next login sees the new state.
      if (transition.to === "verified") page = "unavailable";
      // A hold that was not applied is never decided: the request moved on without it. Tell no one; the person tries again.
      if (transition.to === "identity_held") {
        page = "unavailable";
        notice = null;
      }
    }
  }

  if (notice) {
    try {
      await ports.notify(request.id, notice);
    } catch (error) {
      console.error(`identity check: notice for request ${request.id} failed`, error);
    }
  }
  return { result: decision.result, page, transition, applied, failedChecks, audit: decision.audit, notice };
}
