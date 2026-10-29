import type { auditLog } from "@/server/db/schema";
import type { Notice } from "@/server/matrix/notices";

import { checkIdentity, keycloakUnreachable, type CheckResult, type IdentityResult, type LoginIdentity } from "./checks";

// What follows from the identity checks at login, docs/IDENTITY.md ("Identity checks") and docs/ARCHITECTURE.md
// ("Request lifecycle"). `decideLogin` is pure. `runIdentityChecks` is the seam the callback (T07, #6) calls, with the
// request store and audit writer from the request core (T04, #3) passed in as ports.

/** Three failed identity checks lock the link. */
export const MAX_FAILED_CHECKS = 3;

export type AuditEntry = Omit<typeof auditLog.$inferInsert, "id" | "at">;

/** The request fields the checks need. `failedChecks` is `requests.failed_checks` before this login. */
export type CheckedRequest = { id: number; given: string; family: string; org: string; failedChecks: number };

/**
 * What the outside person sees. Only `answer` shows the patient and the document type.
 * - `held`: Dr. Hofer decides in the widget.
 * - `wrong_person`: "This request is for someone else. Nothing was shared with you."
 * - `unavailable`: ID Austria could not be reached, try again later.
 */
export type LoginPage = "answer" | "held" | "wrong_person" | "unavailable";

export type LoginDecision = {
  result: IdentityResult;
  /** The state the check asks for. Null keeps the state. The lifecycle module (T04) applies it. */
  state: "verified" | "identity_held" | "locked" | null;
  /** `requests.failed_checks` after this login. */
  failedChecks: number;
  page: LoginPage;
  audit: AuditEntry[];
  notice: Notice | null;
};

const fullName = (login: LoginIdentity) => `${login.givenName} ${login.familyName}`;

/** Only what the checks found. Never the patient, never document text. */
const checkDetail = (checks: CheckResult[]) => ({ checks: checks.map(({ check, verdict, reason }) => ({ check, verdict, reason })) });

/**
 * Turns a check result into the request change, the audit entries and the notice to Dr. Hofer.
 * `recipient` is how notices name the requested person, for example "Dr. Eva Brandl". `login` is null when Keycloak
 * could not be reached.
 */
export function decideLogin(request: CheckedRequest, recipient: string, login: LoginIdentity | null, result: IdentityResult): LoginDecision {
  const actor = login
    ? { actorKind: "outside_person" as const, actor: `${fullName(login)} (${login.personNumber ?? "no person number"})` }
    : { actorKind: "anonymous" as const, actor: "ID Austria login" };
  const checked: AuditEntry = { event: "identity_checked", requestId: request.id, ...actor, outcome: result.verdict, detail: checkDetail(result.checks) };

  if (result.verdict === "fail") {
    const failedChecks = request.failedChecks + 1;
    const failed = result.checks.filter((c) => c.verdict === "fail");
    return {
      result,
      state: failedChecks >= MAX_FAILED_CHECKS ? "locked" : null,
      failedChecks,
      page: "wrong_person",
      audit: [
        checked,
        { event: "misdelivery_caught", requestId: request.id, ...actor, outcome: "wrong_person", detail: { ...checkDetail(failed), failedChecks } },
      ],
      notice: { kind: "wrong-person", requestId: request.id, recipient, idAustriaName: login ? fullName(login) : "unknown" },
    };
  }

  if (result.verdict === "hold") {
    // Without a login there is nobody for Dr. Hofer to accept. The state stays and the person tries again later.
    if (!login) return { result, state: null, failedChecks: request.failedChecks, page: "unavailable", audit: [checked], notice: null };
    return {
      result,
      state: "identity_held",
      failedChecks: request.failedChecks,
      page: "held",
      audit: [checked],
      notice: { kind: "held", requestId: request.id, hold: "identity", reason: holdReason(result.checks, recipient, login) },
    };
  }

  return { result, state: "verified", failedChecks: request.failedChecks, page: "answer", audit: [checked], notice: null };
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
  /** Stores `failed_checks` and moves the request to `state` through the lifecycle module, unless it is null. */
  saveOutcome(requestId: number, outcome: { state: LoginDecision["state"]; failedChecks: number }): Promise<void>;
  /** Posts the notice in the request's thread with `notifyRoom`. */
  notify(requestId: number, notice: Notice): Promise<void>;
}

export type LoginOutcome = { ok: true; login: LoginIdentity } | { ok: false; reason: "keycloak_unreachable" };

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
): Promise<LoginDecision> {
  let decision: LoginDecision;
  if (outcome.ok) {
    const binding = await ports.findBinding({ given: request.given, family: request.family, org: request.org });
    const result = checkIdentity({ requested: request, login: outcome.login, binding, unreachable });
    decision = decideLogin(request, recipient, outcome.login, result);
  } else {
    decision = decideLogin(request, recipient, null, keycloakUnreachable());
  }

  for (const entry of decision.audit) await ports.recordAudit(entry);
  if (decision.state !== null || decision.failedChecks !== request.failedChecks) {
    await ports.saveOutcome(request.id, { state: decision.state, failedChecks: decision.failedChecks });
  }
  if (decision.notice) {
    try {
      await ports.notify(request.id, decision.notice);
    } catch (error) {
      console.error(`identity check: notice for request ${request.id} failed`, error);
    }
  }
  return decision;
}
