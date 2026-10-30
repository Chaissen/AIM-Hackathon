import { and, eq } from "drizzle-orm";
import { decodeJwt } from "jose";

import { SERVICE_ACTOR, recordAudit } from "@/server/audit/record";
import { bindings } from "@/server/db/schema";
import { parsePersonLine } from "@/server/documents/parse";
import type { PersonLine } from "@/server/documents/types";
import { checkName } from "@/server/identity/checks";
import type { Notice } from "@/server/matrix/notices";
import { TransitionError } from "@/server/requests/lifecycle";
import { applyEvent, type RequestRow } from "@/server/requests/service";
import type { AnswerDeps } from "./deps";
import type { AnswerToFile, FileableDocument, FilingPerson, Sender } from "./ports";

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
export function requesterPerson(requesterName: string): FilingPerson {
  const line = parsePersonLine(requesterName);
  return line ? { titles: line.titles, given: line.given, family: line.family, ehvdOid: null } : { given: "", family: requesterName, ehvdOid: null };
}

/** How notices name the sender: with the document's titles when the sender is the responsible person, for example "Dr. Eva Brandl". */
export function senderName(sender: Sender, responsible: PersonLine | null): string {
  if (responsible && isSender(responsible, sender)) return [...responsible.titles, responsible.given, responsible.family].filter(Boolean).join(" ");
  return `${sender.givenName} ${sender.familyName}`;
}

export function filedNotice(doc: FileableDocument, patient: string, sender: string): Notice {
  if (doc.type === "rehab-report") return { kind: "filed", docType: "rehab-report", patient, sender };
  const outside = doc.rows.filter((row) => row.interpretation === "H" || row.interpretation === "L").length;
  return { kind: "filed", docType: "lab-result", patient, sender, values: { within: doc.rows.length - outside, outside } };
}

/** `Practitioner/12` becomes `12`. */
const practitionerId = (reference: string) => /^Practitioner\/([^/]+)$/.exec(reference)?.[1] ?? null;

/**
 * Files an answer and sets the request to `filed`, in one database transaction with the request row locked. The state,
 * `answer_filed`, and the person number binding commit only if the FHIR server took the whole answer, and a second
 * upload at the same time waits and then finds the request filed. `build` gets the locked request and the Practitioner
 * id the `bindings` table remembers for the bound person.
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
): Promise<RequestRow | null> {
  try {
    return await applyEvent(deps.db, requestId, event, async (tx, request) => {
      const [binding] = await tx
        .select()
        .from(bindings)
        .where(and(eq(bindings.given, request.given), eq(bindings.family, request.family), eq(bindings.org, request.org)));
      const known = binding && binding.personNumber === request.personNumber ? binding.practitionerId : null;
      const answer: AnswerToFile = { request, ...build(request, known) };
      const filed = await deps.fileAnswer(answer);
      await recordAudit(tx, {
        event: "answer_filed",
        requestId,
        actor: SERVICE_ACTOR,
        outcome: "filed",
        detail: { resources: filed.resources, provenance: filed.provenance, ...(acceptedBy && { acceptedBy }) },
      });
      // docs/IDENTITY.md, "Person number binding": the first filed answer binds the person number to the requested name.
      // The Practitioner id is kept only for people the eHVD does not list; the others are found by their eHVD OID.
      if (request.personNumber) {
        await tx
          .insert(bindings)
          .values({
            given: request.given,
            family: request.family,
            org: request.org,
            personNumber: request.personNumber,
            practitionerId: answer.sender.ehvdOid ? null : practitionerId(filed.sender),
          })
          .onConflictDoNothing();
      }
    });
  } catch (error) {
    if (error instanceof TransitionError) return null;
    throw error;
  }
}
