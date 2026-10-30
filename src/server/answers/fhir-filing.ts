import type { Bundle } from "fhir/r4";
import { decodeJwt } from "jose";

import { env } from "@/env";
import { FhirError, transaction } from "@/server/fhir/client";
import { fileAnswer, type FilingDeps } from "@/server/fhir/file-answer";
import { buildFilingBundle, ID_AUSTRIA_SIMULATION, prepareParties, type Filing, type Parties } from "@/server/fhir/filing";
import { mapLabResult, mapRehabReport } from "@/server/fhir/mappers";
import { type AnswerToFile, type FileAnswer, type MapClinical, NotFiled } from "./ports";

// The answer flow's filing on the FHIR server: the parties and one transaction Bundle with Provenance and Task (T13),
// around the clinical resources from the mappers (T12, T14). docs/FHIR.md, "Provenance".

/** The clinical resources from the lab mapper (T12) or the rehab mapper (T14). */
export const mapClinical: MapClinical = (document, context, filedAt) => {
  if (document.type === "lab-result") {
    const { diagnosticReport, observations } = mapLabResult(document, context);
    return { output: diagnosticReport, others: observations };
  }
  return { output: mapRehabReport(document, context, filedAt), others: [] };
};

/** The issuer of the ID token names the identity provider in the Provenance. The token was verified at login. */
function issuer(idToken: string): string {
  const { iss } = decodeJwt(idToken);
  if (typeof iss !== "string" || !iss) throw new Error("The ID token has no issuer");
  return iss;
}

/** The Bundle for one answer. Built again from the same answer, it has the same conditions, so a retry files nothing new. */
export function filingFor(answer: AnswerToFile, mapClinical: MapClinical, filedAt: Date) {
  const { request } = answer;
  const parties: Parties = {
    requester: answer.requester,
    sender: answer.sender,
    author: answer.author,
    organization: answer.organisation,
    identityProvider: { name: ID_AUSTRIA_SIMULATION, issuer: issuer(answer.idToken) },
  };
  const prepared = prepareParties(parties, { requestId: request.id, uploadSha256: answer.uploadSha256 });
  // The patient comes from the request, never from the document (docs/FHIR.md, "Patient").
  const patient = { reference: `Patient/${request.patientId}` };
  return buildFilingBundle({
    request: { id: request.id, docType: request.docType, patient, createdAt: request.createdAt, expiresAt: request.expiresAt },
    parties,
    prepared,
    clinical: mapClinical(answer.document, { patient, organization: prepared.organization, practitioner: prepared.author }, filedAt),
    idToken: answer.idToken,
    sentAt: answer.sentAt,
    filedAt,
    acceptedByRequester: answer.acceptedByRequester,
    findings: answer.findings,
    fhirBaseUrl: env.FHIR_BASE_URL,
  });
}

/**
 * Files on the FHIR server from `.env`. The answer flow writes `answer_filed` in the database transaction that sets
 * the request to `filed` (`fileAndRecord`), so the filing's own audit writer is left out.
 */
export const fhirFiling =
  ({ mapClinical, post = transaction }: { mapClinical: MapClinical; post?: FilingDeps["transaction"] }): FileAnswer =>
  async (answer) => {
    let filing: Filing;
    try {
      filing = filingFor(answer, mapClinical, new Date());
    } catch (error) {
      throw new NotFiled(`The filing Bundle could not be built: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    // HAPI applies a transaction all or nothing, so a FhirError means nothing is filed. A timeout or a lost response
    // leaves it open, and so does an error after the POST.
    const send = async (bundle: Bundle) => {
      try {
        return await post(bundle);
      } catch (error) {
        throw error instanceof FhirError ? new NotFiled(error.message) : error;
      }
    };
    return fileAnswer(answer.request.id, filing, { transaction: send, audit: async () => {} });
  };
