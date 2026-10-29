import { isSubset, nameWords, shares } from "./names";

// The identity checks at login from docs/IDENTITY.md ("Identity checks"). Pure functions: the caller loads the
// binding and the login claims, and login.ts turns the result into a state change, audit entries and a notice.

export type Verdict = "pass" | "hold" | "fail";

export const FULL_FUNCTION = "urn:eidgvat:eid.status.full";
export const BASIC_FUNCTION = "urn:eidgvat:eid.status.basic";

export type LevelReason = "full" | "basic" | "missing" | "unknown";
export type NameReason = "match" | "partial" | "no_shared_family_name" | "requested_name_empty";
export type PersonNumberReason = "no_binding" | "binding_matches" | "binding_differs" | "missing";
export type EhvdClaimReason = "none" | "readable" | "malformed";
export type RequestPersonReason = "same_person" | "other_person";
export type ServiceReason = "keycloak_unreachable" | "ehvd_unreachable";

export type CheckResult =
  | { check: "level"; verdict: Verdict; reason: LevelReason }
  | { check: "name"; verdict: Verdict; reason: NameReason }
  | { check: "person_number"; verdict: Verdict; reason: PersonNumberReason }
  | { check: "ehvd_claim"; verdict: Verdict; reason: EhvdClaimReason }
  | { check: "request_person"; verdict: Verdict; reason: RequestPersonReason }
  | { check: "service"; verdict: Verdict; reason: ServiceReason };

export type IdentityResult = { verdict: Verdict; checks: CheckResult[] };

/** `urn:pvpgvat:oidc.eid_ida_level`: only full function passes. Basic, missing (a foreign eID) or anything else fails. */
export function checkLevel(level: unknown): CheckResult {
  if (level === FULL_FUNCTION) return { check: "level", verdict: "pass", reason: "full" };
  if (level === BASIC_FUNCTION) return { check: "level", verdict: "fail", reason: "basic" };
  if (level === undefined || level === null || level === "") return { check: "level", verdict: "fail", reason: "missing" };
  return { check: "level", verdict: "fail", reason: "unknown" };
}

/** The table in docs/IDENTITY.md ("Name match"): every requested word present passes, a shared family name word holds. */
export function matchRequestedPerson(reqGiven: string, reqFamily: string, idGiven: string, idFamily: string): Verdict {
  const wantFamily = nameWords(reqFamily);
  const gotFamily = nameWords(idFamily);
  if (isSubset(wantFamily, gotFamily) && isSubset(nameWords(reqGiven), nameWords(idGiven))) return "pass";
  if (shares(wantFamily, gotFamily)) return "hold";
  return "fail";
}

export function checkName(requested: { given: string; family: string }, login: { givenName: string; familyName: string }): CheckResult {
  // The request procedure refuses empty names, but "Dr." alone is empty after the titles are dropped, and an empty set
  // passes every subset test. Never pass it; Dr. Hofer decides.
  if (nameWords(requested.given).size === 0 || nameWords(requested.family).size === 0) {
    return { check: "name", verdict: "hold", reason: "requested_name_empty" };
  }
  const verdict = matchRequestedPerson(requested.given, requested.family, login.givenName, login.familyName);
  const reason = verdict === "pass" ? "match" : verdict === "hold" ? "partial" : "no_shared_family_name";
  return { check: "name", verdict, reason };
}

/**
 * The person number binding: the bPK stored in `bindings` for the requested name and organisation, or null before the
 * first filed answer. Compare `urn:pvpgvat:oidc.bpk`, never `sub`.
 */
export function checkPersonNumber(binding: string | null, personNumber: string | null | undefined): CheckResult {
  if (!personNumber) return { check: "person_number", verdict: "fail", reason: "missing" };
  if (binding === null) return { check: "person_number", verdict: "pass", reason: "no_binding" };
  return binding === personNumber
    ? { check: "person_number", verdict: "pass", reason: "binding_matches" }
    : { check: "person_number", verdict: "fail", reason: "binding_differs" };
}

/** The result of `gdaOidFromClaim`. A present but unreadable claim fails; it never counts as a person without an entry. */
export function checkEhvdClaim(gdaOid: string | null | Error): CheckResult {
  if (gdaOid instanceof Error) return { check: "ehvd_claim", verdict: "fail", reason: "malformed" };
  return { check: "ehvd_claim", verdict: "pass", reason: gdaOid === null ? "none" : "readable" };
}

/**
 * The person the request is already bound to (`requests.person_number`): the one who passed, or the one Dr. Hofer
 * accepted. Only that person may answer, so anyone else fails, even with the right name.
 */
export function checkRequestPerson(bound: string, personNumber: string | null | undefined): CheckResult {
  return personNumber === bound
    ? { check: "request_person", verdict: "pass", reason: "same_person" }
    : { check: "request_person", verdict: "fail", reason: "other_person" };
}

/** A service the checks depend on could not be reached. That is a hold, never a pass. */
export const serviceUnreachable = (service: "keycloak" | "ehvd"): CheckResult => ({
  check: "service",
  verdict: "hold",
  reason: `${service}_unreachable`,
});

/** Any fail fails, otherwise any hold holds. */
export function combine(checks: CheckResult[]): IdentityResult {
  const verdict = checks.some((c) => c.verdict === "fail") ? "fail" : checks.some((c) => c.verdict === "hold") ? "hold" : "pass";
  return { verdict, checks };
}

/** The claims T07 reads from the verified ID token (see `eidSession` in src/server/auth/eid-session.ts). */
export type LoginIdentity = {
  givenName: string;
  familyName: string;
  /** `urn:pvpgvat:oidc.bpk`. */
  personNumber: string | null;
  /** `urn:pvpgvat:oidc.eid_ida_level` as received. */
  level: unknown;
  /** `gdaOidFromClaim(urn:eidgvat:attributes.gda)`. */
  gdaOid: string | null | Error;
};

export type IdentityCheckInput = {
  requested: { given: string; family: string };
  login: LoginIdentity;
  /** The bound bPK for the requested name and organisation, or null. */
  binding: string | null;
  /**
   * The bPK the request is bound to once it is verified: the person who passed, or the held person Dr. Hofer accepted.
   * Null before that. Pass it only for a verified request; a held person is not accepted yet.
   */
  accepted?: string | null;
  /** Services that could not be reached while checking this login, for example the eHVD for the claim's OID. */
  unreachable?: ReadonlyArray<"ehvd">;
};

/** All checks for one login. When Keycloak itself cannot be reached there is no login; use `keycloakUnreachable()`. */
export function checkIdentity({ requested, login, binding, accepted = null, unreachable = [] }: IdentityCheckInput): IdentityResult {
  const result = combine([
    checkLevel(login.level),
    checkName(requested, login),
    checkPersonNumber(binding, login.personNumber),
    checkEhvdClaim(login.gdaOid),
    ...(accepted === null ? [] : [checkRequestPerson(accepted, login.personNumber)]),
    ...unreachable.map(serviceUnreachable),
  ]);
  // Dr. Hofer already accepted this person, or they passed before: a partial name or an outage no longer holds them.
  // The checks keep their own verdicts for the audit log. A fail still fails.
  if (result.verdict === "hold" && accepted !== null && login.personNumber === accepted) return { verdict: "pass", checks: result.checks };
  return result;
}

/** Keycloak (ID Austria) could not be reached, so no identity was verified. A hold, never a pass. */
export const keycloakUnreachable = (): IdentityResult => combine([serviceUnreachable("keycloak")]);
