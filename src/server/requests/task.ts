import { syncTask } from "@/server/fhir/file-answer";
import type { NonLoginEvent, RequestRow } from "./service";

// The FHIR Task follows the request (docs/FHIR.md, "Task"). The filing Bundle PUTs it `completed` with the output in
// the same FHIR transaction as the answer; the request service calls `mirrorTask` for every other state change, after
// the change committed.

const BUSINESS_STATUS: Partial<Record<NonLoginEvent, string>> = {
  patient_mismatch: "waiting for a new upload after a patient mismatch",
};

/**
 * PUTs the request's Task with the status for its state. Before the filing, the outside person has no Practitioner,
 * so `owner` and `requester` carry only the names. Never throws: the request is the record, and the Task follows it on
 * the next change. A failure is logged with the request id only.
 */
export async function mirrorTask(request: RequestRow, event?: NonLoginEvent): Promise<void> {
  const businessStatus = event && BUSINESS_STATUS[event];
  try {
    await syncTask({
      requestId: request.id,
      docType: request.docType,
      state: request.state,
      ...(businessStatus && { businessStatus }),
      patient: { reference: `Patient/${request.patientId}` },
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      requester: { display: request.requesterName },
      owner: { display: `${request.given} ${request.family}` },
    });
  } catch (error) {
    console.error(`the Task of request ${request.id} was not updated: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
