import { eq } from "drizzle-orm";

import { recordAudit } from "@/server/audit/record";
import { heldAnswers, keptAnswers } from "@/server/db/schema";
import { HELD_REASON, readAgain } from "@/server/documents/fallback";
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

/** The Provenance sentence for an answer the AI fallback read (docs/FHIR.md, "Provenance"). It names the model, never a value. */
export const modelFinding = (model: string) =>
  `The parser could not read the document's format, so the AI fallback read it: code read every value, and the language model ${model} read it on its own and agreed.`;

/**
 * The Provenance sentences of a held answer: the hold reason, or for an answer the AI fallback read, the model sentence
 * in place of the notice's opening (`HELD_REASON`), then the release check's sentence that followed it.
 */
function heldFindings(reason: string, readByModel: string | null): string[] {
  if (readByModel === null) return [reason];
  const release = reason.startsWith(HELD_REASON) ? reason.slice(HELD_REASON.length).trim() : reason;
  return [modelFinding(readByModel), ...(release ? [release] : [])];
}

/** An Accept's filing outcome is unknown: the FHIR server may have the answer, so only Accept again may end it. */
export class FilingOutcomeOpen extends Error {
  constructor(readonly requestId: number) {
    super(`The filing of the answer to request ${requestId} has an open outcome`);
  }
}

/**
 * Files the held answer of a request in `answer_held` and sets it to `filed`. `acceptedBy` is the Matrix ID of the
 * network member who accepts; it must be the one who sent the request, and `request_decided` and `answer_filed` record
 * it. The Organization
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
  // The parser and the fallback's code reader are deterministic and read this text before, so this gives the record
  // that was held, and only fails after a code change. The model is not asked again: it agreed before the hold.
  const parsed = held.readByModel === null ? parseDocument(held.markdown) : readAgain(held.markdown);
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
        findings: heldFindings(held.reason, held.readByModel),
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
 * Rejects a held answer: the request is `cancelled`, the answer is deleted, and `request_decided` names `rejectedBy`.
 * `rejectedBy` must be the network member who sent the request. Null when the request is not `answer_held` or was sent
 * by someone else. Throws FilingOutcomeOpen while an Accept's filing outcome is open: the FHIR server may have the
 * answer, so Accept again first.
 */
export async function rejectAnswer(deps: Pick<AnswerDeps, "db">, requestId: number, rejectedBy: string): Promise<RequestRow | null> {
  const request = await getRequest(deps.db, requestId);
  // `reject` also ends an identity hold; this is only for a held answer. A held answer never goes back to an identity
  // hold, and every other state refuses `reject`, so the check still holds when the event runs.
  if (request?.state !== "answer_held" || request.requester !== rejectedBy) return null;
  try {
    return await applyEvent(deps.db, requestId, "reject", async (tx, changed, from) => {
      const [kept] = await tx.select({ requestId: keptAnswers.requestId }).from(keptAnswers).where(eq(keptAnswers.requestId, requestId));
      if (kept) throw new FilingOutcomeOpen(requestId);
      await recordAudit(tx, {
        event: "request_decided",
        requestId,
        actor: { kind: "network_member", id: rejectedBy },
        outcome: "rejected",
        detail: { from, to: changed.state },
      });
    });
  } catch (error) {
    if (error instanceof TransitionError) return null;
    throw error;
  }
}
