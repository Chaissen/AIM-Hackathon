import type { Bundle } from "fhir/r4";

import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { put, transaction } from "@/server/fhir/client";
import { buildTask, locationId, resolveIds, type Filing, type TaskInput } from "@/server/fhir/filing";

// The I/O half of the filing: POST the transaction Bundle to HAPI, then write `answer_filed`.
// docs/FHIR.md, "Provenance" and "Validation", and docs/ARCHITECTURE.md, "Audit log".

/** The `answer_filed` detail. `pnpm validate` (T18) reads `resources` to fetch every filed resource. */
export type AnswerFiled = {
  /** The DiagnosticReport or DocumentReference, for example `DiagnosticReport/12`. */
  output: string;
  /** Every clinical resource of the answer, the output first. */
  targets: string[];
  provenance: string;
  task: string;
  /** The sender's Practitioner. T04 stores it in `bindings` for a person without an eHVD entry. */
  sender: string;
  author: string;
  organization: string;
  /**
   * Every resource in the transaction, created or matched, the Task included. A Practitioner known from `bindings`
   * is only referenced, so it is in `sender` or `author` but not here.
   */
  resources: string[];
};

export type FilingDeps = {
  transaction: (bundle: Bundle) => Promise<Bundle>;
  audit: (requestId: number, detail: AnswerFiled) => Promise<void>;
};

// Until the audit writer from T04 exists, insert into audit_log directly.
async function writeAnswerFiled(requestId: number, detail: AnswerFiled) {
  await db.insert(auditLog).values({ event: "answer_filed", requestId, actorKind: "service", actor: "ordy", outcome: "filed", detail });
}

/**
 * Files one answer and writes `answer_filed`.
 *
 * An error means the answer may or may not be on the server: HAPI may have rejected the transaction (FhirError with
 * its status), or committed it while the response was lost (timeout, network) or the audit insert failed afterwards.
 * Keep the answer and call `fileAnswer` again with a Bundle built from the same answer (same request id and upload
 * hash). Every POST is a conditional create, so the retry files nothing new, gets back the ids of what the first
 * attempt filed, and writes the audit entry.
 */
export async function fileAnswer(
  requestId: number,
  filing: Filing,
  deps: FilingDeps = { transaction, audit: writeAnswerFiled },
): Promise<AnswerFiled> {
  const response = await deps.transaction(filing.bundle);
  const id = resolveIds(filing.bundle, response);
  const { refs } = filing;
  const detail: AnswerFiled = {
    output: id(refs.output),
    targets: refs.targets.map(id),
    provenance: id(refs.provenance),
    task: id(refs.task),
    sender: id(refs.sender),
    author: id(refs.author),
    organization: id(refs.organization),
    resources: [...new Set((response.entry ?? []).flatMap((entry) => locationId(entry.response?.location) ?? []))],
  };
  await deps.audit(requestId, detail);
  return detail;
}

/** Mirrors a request state change on its Task (docs/ARCHITECTURE.md, "Request lifecycle"). For T04. */
export const syncTask = (input: TaskInput) => put(buildTask(input));
