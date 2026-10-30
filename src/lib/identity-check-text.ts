import type { IdentityCheck } from "@/server/audit/record";
import type { CheckResult } from "@/server/identity/checks";

// The identity checks of src/server/identity/checks.ts in words, for the widget's Technical details.

export const CHECK_LABEL: Record<CheckResult["check"], string> = {
  level: "Function level",
  name: "Name",
  person_number: "Person number",
  ehvd_claim: "eHVD entry in the login",
  request_person: "Bound person",
  service: "Services",
};

export const CHECK_TEXT: { [C in CheckResult as C["check"]]: Record<C["reason"], string> } = {
  level: {
    full: "The ID Austria login has full function.",
    basic: "The login has only basic function, and a request needs full function.",
    missing: "The login did not say its function level.",
    unknown: "The login gave a function level that is neither full nor basic.",
  },
  name: {
    match: "The name matches the person you asked for.",
    partial: "The name matches only in part.",
    no_shared_family_name: "The family name is different.",
    requested_name_empty: "The name you entered has no words to compare.",
  },
  person_number: {
    no_binding: "First answer from this person at this organisation.",
    binding_matches: "Same person number as last time.",
    binding_differs: "Someone else answered as this person before.",
    missing: "The login carried no person number.",
  },
  ehvd_claim: {
    none: "The login carried no eHVD entry.",
    readable: "The login carried an eHVD entry.",
    malformed: "The login's eHVD entry could not be read.",
  },
  request_person: {
    same_person: "The person this request is bound to.",
    other_person: "Not the person this request is bound to.",
    unbound: "The request is bound to nobody.",
  },
  service: {
    keycloak_unreachable: "ID Austria could not be reached.",
    ehvd_unreachable: "The eHVD could not be reached.",
  },
};

/** The sentence for one stored check. A reason that does not belong to its check, such as an older one, reads as the code. */
export function checkText({ check, reason }: { check: IdentityCheck["check"]; reason: string }): string {
  const texts: Partial<Record<string, string>> = CHECK_TEXT[check];
  return texts[reason] ?? reason;
}
