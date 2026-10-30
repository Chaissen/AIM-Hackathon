import { type AuditEntry, recordAudit } from "@/server/audit/record";
import type { Db } from "@/server/db";
import type { IdentityCheckPorts } from "@/server/identity/login";
import { applyLoginTransition, findBinding, incrementFailedChecks } from "./service";

/**
 * The five ports `runIdentityChecks` takes (docs/IDENTITY.md, "Identity checks"), built from the request service.
 * The caller passes `notify`, because the request's thread in Dr. Hofer's room belongs to T05.
 */
export function identityCheckPorts(db: Db, notify: IdentityCheckPorts["notify"]): IdentityCheckPorts {
  return {
    findBinding: (key) => findBinding(db, key),
    recordAudit: async (entry) => {
      // login.ts builds every entry from typed check results, so `detail` holds check names, verdicts, and reason codes only.
      const { event, requestId, actorKind, actor, outcome, detail } = entry;
      await recordAudit(db, { event, requestId: requestId ?? null, actor: { kind: actorKind, id: actor }, outcome, detail } as AuditEntry);
    },
    incrementFailedChecks: (requestId) => incrementFailedChecks(db, requestId),
    transition: (requestId, change) => applyLoginTransition(db, requestId, change),
    notify,
  };
}
