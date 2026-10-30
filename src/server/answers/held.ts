import { eq } from "drizzle-orm";

import { heldAnswers, keptAnswers } from "@/server/db/schema";
import { parseDocument } from "@/server/documents/parse";
import { TransitionError } from "@/server/requests/lifecycle";
import { applyEvent, getRequest, type RequestRow } from "@/server/requests/service";
import type { AnswerDeps } from "./deps";
import { type Filed, fileAndRecord, filedNotice, isSender, logReason, requesterPerson, responsiblePerson } from "./file";

// Dr. Hofer's decision on a held answer (docs/IDENTITY.md, "Block or hold"). The widget's Accept and Reject (T05, #14)
// call these. Accepting files the answer with the policy `accepted-by-requester`; rejecting drops it.

export class NoHeldAnswer extends Error {
  constructor(readonly requestId: number) {
    super(`Request ${requestId} has no held answer`);
  }
}

/**
 * Files the held answer of a request in `answer_held` and sets it to `filed`. `acceptedBy` is the Matrix ID of the
 * network member who accepts; it must be the one who sent the request, and `answer_filed` records it. The Organization
 * and the responsible person carry the eHVD OIDs the release check found before it held, if any. The sender's login
 * claim names the sender only when the sender is not the responsible person; otherwise the check's entry decides,
 * so a claim the eHVD contradicted (`claim_differs`) is never filed.
 *
 * Returns null when the request is not `answer_held` any more or was sent by someone else. Throws NoHeldAnswer when
 * there is nothing to file, and an error when the filing fails; the request then stays held, and an answer whose
 * filing outcome is unknown is kept, so Accept again files exactly it (docs/FHIR.md, "Retries").
 */
export async function acceptAnswer(deps: AnswerDeps, requestId: number, acceptedBy: string): Promise<RequestRow | null> {
  const request = await getRequest(deps.db, requestId);
  if (request?.state !== "answer_held" || request.requester !== acceptedBy) return null;
  const [held] = await deps.db.select().from(heldAnswers).where(eq(heldAnswers.requestId, requestId));
  if (!held) throw new NoHeldAnswer(requestId);
  const parsed = parseDocument(held.markdown);
  // The parser is deterministic and read this text before, so this only fails after a parser change.
  if (!parsed.ok || parsed.document.type === "other") throw new Error(`The held answer to request ${requestId} cannot be read any more`);
  const doc = parsed.document;
  // Before filing, so a FHIR read error cannot turn a filed answer into a failed Accept.
  const patient = await deps.readPatient(request.patientId);
  const responsible = responsiblePerson(doc);
  const authorIsSender = !responsible || isSender(responsible, held.sender);

  let filed: Filed | null;
  try {
    filed = await fileAndRecord(
      deps,
      requestId,
      "accept",
      (locked, knownPractitioner) => ({
        document: doc,
        requester: requesterPerson(locked.requesterName),
        sender: {
          given: held.sender.givenName,
          family: held.sender.familyName,
          ehvdOid: responsible && authorIsSender ? held.practitionerOid : held.sender.gdaOid,
          practitionerId: knownPractitioner,
          ...(authorIsSender && responsible ? { titles: responsible.titles } : {}),
        },
        author:
          authorIsSender || !responsible
            ? null
            : { titles: responsible.titles, given: responsible.given, family: responsible.family, ehvdOid: held.practitionerOid },
        organisation: { name: locked.org, ehvdOid: held.organisationOid },
        idToken: held.idToken,
        sentAt: held.sentAt,
        uploadSha256: held.sha256,
        acceptedByRequester: true,
        findings: [held.reason],
      }),
      acceptedBy,
    );
  } catch (error) {
    // The cause stays out: a database error's message carries the document and the ID token.
    throw new Error(`Filing the held answer to request ${requestId} failed: ${logReason(error)}`);
  }
  if (!filed) return null;
  await deps.notify(filed.request, filedNotice(filed, patient.display));
  return filed.request;
}

/**
 * Rejects a held answer: the request is `cancelled` and the answer is deleted. `rejectedBy` must be the network member
 * who sent the request. Null when the request is not `answer_held`, was sent by someone else, or an Accept's filing
 * outcome is still open: the FHIR server may have the answer, so Accept again first.
 */
export async function rejectAnswer(deps: Pick<AnswerDeps, "db">, requestId: number, rejectedBy: string): Promise<RequestRow | null> {
  const request = await getRequest(deps.db, requestId);
  // `reject` also ends an identity hold; this is only for a held answer. A held answer never goes back to an identity
  // hold, and every other state refuses `reject`, so the check still holds when the event runs.
  if (request?.state !== "answer_held" || request.requester !== rejectedBy) return null;
  try {
    return await applyEvent(deps.db, requestId, "reject", async (tx) => {
      const [kept] = await tx.select({ requestId: keptAnswers.requestId }).from(keptAnswers).where(eq(keptAnswers.requestId, requestId));
      if (kept) throw new NotRejected();
    });
  } catch (error) {
    if (error instanceof NotRejected || error instanceof TransitionError) return null;
    throw error;
  }
}

class NotRejected extends Error {}
