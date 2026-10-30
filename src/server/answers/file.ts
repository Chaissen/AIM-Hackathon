import { and, eq } from "drizzle-orm";
import { decodeJwt } from "jose";

import { SERVICE_ACTOR, recordAudit } from "@/server/audit/record";
import { bindings, keptAnswers, requests } from "@/server/db/schema";
import { parsePersonLine } from "@/server/documents/parse";
import type { PersonLine } from "@/server/documents/types";
import { displayName, type Person } from "@/server/fhir/filing";
import { checkName } from "@/server/identity/checks";
import type { Notice } from "@/server/matrix/notices";
import { TransitionError } from "@/server/requests/lifecycle";
import { applyEvent, type RequestRow } from "@/server/requests/service";
import type { AnswerDeps } from "./deps";
import { type AnswerToFile, type FileableDocument, type KeptAnswer, NotFiled, type Sender } from "./ports";

// Shared by a new answer (submit.ts) and an accepted held answer (held.ts): who is who, and the filing itself.

/** The person responsible for the content: `Validated by` for a lab result, `Written by` for a rehab report. */
export const responsiblePerson = (doc: FileableDocument): PersonLine | null => (doc.type === "lab-result" ? doc.validatedBy : doc.writtenBy);

/** The responsible person has the sender's name, by the same rule as the name check at login. */
export const isSender = (person: PersonLine, sender: Sender) =>
  checkName({ given: person.given, family: person.family }, { givenName: sender.givenName, familyName: sender.familyName }).verdict === "pass";

/** The bPK in an ID token. The answer flow files only with the token of the person the request is bound to. */
export function idTokenPersonNumber(idToken: string): string | null {
  try {
    const bpk = decodeJwt(idToken)["urn:pvpgvat:oidc.bpk"];
    return typeof bpk === "string" ? bpk : null;
  } catch {
    return null;
  }
}

/** Dr. Hofer as the request names her, for example "Dr. Lena Hofer". */
export function requesterPerson(requesterName: string): Person {
  const line = parsePersonLine(requesterName);
  return line ? { titles: line.titles, given: line.given, family: line.family, ehvdOid: null } : { given: "", family: requesterName, ehvdOid: null };
}

/** The filed notice names the sender as the Practitioner does, for example "Dr. Eva Brandl" or "Stefan Kern". */
export function filedNotice({ answer }: Filed, patient: string): Notice {
  const doc = answer.document;
  const sender = displayName(answer.sender);
  if (doc.type === "rehab-report") return { kind: "filed", docType: "rehab-report", patient, sender };
  const outside = doc.rows.filter((row) => row.interpretation === "H" || row.interpretation === "L").length;
  return { kind: "filed", docType: "lab-result", patient, sender, values: { within: doc.rows.length - outside, outside } };
}

/** `Practitioner/12` becomes `12`. */
const practitionerId = (reference: string) => /^Practitioner\/([^/]+)$/.exec(reference)?.[1] ?? null;

/** What was filed: the request in `filed` and the answer as it went to the FHIR server. */
export type Filed = { request: RequestRow; answer: AnswerToFile };

/** JSON for `kept_answers`. The request is read again when the answer is filed. */
const toKept = ({ document, requester, sender, author, organisation, idToken, sentAt, uploadSha256, acceptedByRequester, findings }: AnswerToFile): KeptAnswer => ({
  document,
  requester,
  sender,
  author,
  organisation,
  idToken,
  sentAt: sentAt.toISOString(),
  uploadSha256,
  acceptedByRequester,
  findings,
});

/**
 * Files an answer and sets the request to `filed`, with the request row locked. The state, `answer_filed`, and the
 * person number binding commit only if the FHIR server took the whole answer, and a second upload at the same time
 * waits and then finds the request filed. `build` gets the locked request and the Practitioner id the `bindings` table
 * remembers for the bound person.
 *
 * docs/FHIR.md, "Retries": for `answer_confirmed`, a kept answer goes first and is filed exactly as it was kept; `build`
 * is then not called. When the filing fails with an unknown outcome, the answer is kept while the row is still locked,
 * so no other upload gets in between. When the FHIR server certainly has nothing (NotFiled), the kept answer is dropped,
 * and the next upload is a new answer. A held answer that Accept files is kept in `held_answers` anyway.
 *
 * Returns null when the request no longer accepts `event`, for example because Dr. Hofer cancelled it in between.
 * Throws when the filing fails; the request then stays as it was.
 */
export async function fileAndRecord(
  deps: AnswerDeps,
  requestId: number,
  event: "answer_confirmed" | "accept",
  build: (request: RequestRow, knownPractitioner: string | null) => Omit<AnswerToFile, "request">,
  acceptedBy?: string,
): Promise<Filed | null> {
  const result = await deps.db.transaction(async (outer): Promise<{ filed: Filed | null } | { error: unknown }> => {
    // Locked outside the event's savepoint, so the lock outlasts a failed filing until the answer is kept.
    await outer.select({ id: requests.id }).from(requests).where(eq(requests.id, requestId)).for("update");
    const [kept] = event === "answer_confirmed" ? await outer.select().from(keptAnswers).where(eq(keptAnswers.requestId, requestId)) : [];
    let answer: AnswerToFile | undefined;
    try {
      const request = await applyEvent(outer, requestId, event, async (tx, locked) => {
        const [binding] = await tx
          .select()
          .from(bindings)
          .where(and(eq(bindings.given, locked.given), eq(bindings.family, locked.family), eq(bindings.org, locked.org)));
        const known = binding && binding.personNumber === locked.personNumber ? binding.practitionerId : null;
        answer = kept ? { ...kept.answer, request: locked, sentAt: new Date(kept.answer.sentAt) } : { request: locked, ...build(locked, known) };
        const filed = await deps.fileAnswer(answer);
        await recordAudit(tx, {
          event: "answer_filed",
          requestId,
          actor: SERVICE_ACTOR,
          outcome: "filed",
          detail: { ...filed, ...(acceptedBy && { acceptedBy }) },
        });
        // docs/IDENTITY.md, "Person number binding": the first filed answer binds the person number to the requested name.
        // The Practitioner id is kept only for people the eHVD does not list; the others are found by their eHVD OID.
        if (locked.personNumber) {
          await tx
            .insert(bindings)
            .values({
              given: locked.given,
              family: locked.family,
              org: locked.org,
              personNumber: locked.personNumber,
              practitionerId: answer.sender.ehvdOid ? null : practitionerId(filed.sender),
            })
            .onConflictDoNothing();
        }
      });
      return { filed: request && answer ? { request, answer } : null };
    } catch (error) {
      if (error instanceof TransitionError) return { filed: null };
      if (event === "answer_confirmed" && answer) {
        if (error instanceof NotFiled) await outer.delete(keptAnswers).where(eq(keptAnswers.requestId, requestId));
        else {
          const value = toKept(answer);
          await outer
            .insert(keptAnswers)
            .values({ requestId, answer: value })
            .onConflictDoUpdate({ target: keptAnswers.requestId, set: { answer: value, failedAt: new Date() } });
        }
      }
      return { error };
    }
  });
  if ("error" in result) throw result.error;
  return result.filed;
}
