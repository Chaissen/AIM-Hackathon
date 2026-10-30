import { eq } from "drizzle-orm";

import { heldAnswers } from "@/server/db/schema";
import { parseDocument } from "@/server/documents/parse";
import { applyEvent, getRequest, type RequestRow } from "@/server/requests/service";
import type { AnswerDeps } from "./deps";
import { fileAndRecord, filedNotice, isSender, requesterPerson, responsiblePerson, senderName } from "./file";

// Dr. Hofer's decision on a held answer (docs/IDENTITY.md, "Block or hold"). The widget's Accept and Reject (T05, #14)
// call these. Accepting files the answer with the policy `accepted-by-requester`; rejecting drops it.

export class NoHeldAnswer extends Error {
  constructor(readonly requestId: number) {
    super(`Request ${requestId} has no held answer`);
  }
}

/**
 * Files the held answer of a request in `answer_held` and sets it to `filed`. `acceptedBy` is the Matrix ID of the
 * network member who accepted; `answer_filed` records it. The eHVD did not confirm anyone, so the Practitioner and
 * Organization carry no eHVD OID beyond the sender's own login claim.
 *
 * Returns null when the request is not `answer_held` any more. Throws NoHeldAnswer when there is nothing to file, and
 * the filing error when the FHIR server refuses it; the request then stays held.
 */
export async function acceptAnswer(deps: AnswerDeps, requestId: number, acceptedBy: string): Promise<RequestRow | null> {
  const request = await getRequest(deps.db, requestId);
  if (request?.state !== "answer_held") return null;
  const [held] = await deps.db.select().from(heldAnswers).where(eq(heldAnswers.requestId, requestId));
  if (!held) throw new NoHeldAnswer(requestId);
  const parsed = parseDocument(held.markdown);
  // The parser is deterministic and read this text before, so this only fails after a parser change.
  if (!parsed.ok || parsed.document.type === "other") throw new Error(`The held answer to request ${requestId} cannot be read any more`);
  const doc = parsed.document;
  const responsible = responsiblePerson(doc);
  const authorIsSender = !responsible || isSender(responsible, held.sender);

  const filed = await fileAndRecord(
    deps,
    requestId,
    "accept",
    (locked, knownPractitioner) => ({
      document: doc,
      requester: requesterPerson(locked.requesterName),
      sender: {
        given: held.sender.givenName,
        family: held.sender.familyName,
        ehvdOid: held.sender.gdaOid,
        practitionerId: knownPractitioner,
        ...(authorIsSender && responsible ? { titles: responsible.titles } : {}),
      },
      author: authorIsSender || !responsible ? null : { titles: responsible.titles, given: responsible.given, family: responsible.family, ehvdOid: null },
      organisation: { name: locked.org, ehvdOid: null },
      idToken: held.idToken,
      sentAt: held.sentAt,
      uploadSha256: held.sha256,
      acceptedByRequester: true,
      findings: [held.reason],
    }),
    acceptedBy,
  );
  if (!filed) return null;
  const patient = await deps.readPatient(filed.patientId);
  await deps.notify(filed, filedNotice(doc, patient.display, senderName(held.sender, responsible)));
  return filed;
}

/** Rejects a held answer: the request is `cancelled` and the answer is deleted. Null for an unknown request. */
export const rejectAnswer = (deps: Pick<AnswerDeps, "db">, requestId: number) => applyEvent(deps.db, requestId, "reject");
