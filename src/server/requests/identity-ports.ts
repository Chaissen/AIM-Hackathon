import { z } from "zod";

import { type AuditEntry, type IdentityCheck, recordAudit } from "@/server/audit/record";
import type { Db } from "@/server/db";
import type { Verdict } from "@/server/identity/checks";
import type { IdentityCheckPorts } from "@/server/identity/login";
import { applyLoginTransition, findBinding, incrementFailedChecks } from "./service";

// One member of a string union. The record has to list every member, so the compiler notices a new check, verdict, or reason.
const oneOf = <T extends string>(members: Record<T, true>) =>
  z.custom<T>((value) => typeof value === "string" && Object.hasOwn(members, value));

const verdict = oneOf<Verdict>({ pass: true, hold: true, fail: true });

// The detail of a login's audit entries: check names, verdicts, and reason codes, and nothing else.
const checkDetail = z.strictObject({
  checks: z.array(
    z.strictObject({
      check: oneOf<IdentityCheck["check"]>({ level: true, name: true, person_number: true, ehvd_claim: true, request_person: true, service: true }),
      result: verdict,
      reason: oneOf<IdentityCheck["reason"]>({
        full: true,
        basic: true,
        missing: true,
        unknown: true,
        match: true,
        partial: true,
        no_shared_family_name: true,
        requested_name_empty: true,
        no_binding: true,
        binding_matches: true,
        binding_differs: true,
        none: true,
        readable: true,
        malformed: true,
        same_person: true,
        other_person: true,
        unbound: true,
        keycloak_unreachable: true,
        ehvd_unreachable: true,
      }),
    }),
  ),
});

type LoginAuditEntry = Parameters<IdentityCheckPorts["recordAudit"]>[0];

/**
 * A login writes `identity_checked` with its verdict and `misdelivery_caught` with `wrong_person`, both with the checks.
 * The entry is parsed, not cast, so the audit types hold for the login too and nothing else reaches the log.
 */
function loginAuditEntry({ event, requestId, actorKind, actor, outcome, detail }: LoginAuditEntry): AuditEntry {
  const base = { requestId: requestId ?? null, actor: { kind: actorKind, id: actor }, detail: checkDetail.parse(detail) };
  const checked = verdict.safeParse(outcome);
  if (event === "identity_checked" && checked.success) return { ...base, event, outcome: checked.data };
  if (event === "misdelivery_caught" && outcome === "wrong_person") return { ...base, event, outcome };
  throw new Error(`A login does not write ${event} with ${outcome}`);
}

/**
 * The five ports `runIdentityChecks` takes (docs/IDENTITY.md, "Identity checks"), built from the request service.
 * The caller passes `notify`, because the request's thread in Dr. Hofer's room belongs to T05.
 */
export function identityCheckPorts(db: Db, notify: IdentityCheckPorts["notify"]): IdentityCheckPorts {
  return {
    findBinding: (key) => findBinding(db, key),
    recordAudit: async (entry) => {
      await recordAudit(db, loginAuditEntry(entry));
    },
    incrementFailedChecks: (requestId) => incrementFailedChecks(db, requestId),
    transition: (requestId, change) => applyLoginTransition(db, requestId, change),
    notify,
  };
}
