import type { Reference } from "fhir/r4";

import type { LabResult, RehabReport } from "@/server/documents/types";
import type { AnswerFiled } from "@/server/fhir/file-answer";
import type { AnswerFiling, OrganizationParty, Person } from "@/server/fhir/filing";
import type { RequestRow } from "@/server/requests/service";

// What the answer flow needs from the eHVD release check (T15, #11), the FHIR mappers (T12, T14, #10), and the filing
// (T13). They are passed in, so the flow runs and is tested before the first two land. Until then the defaults below
// hold every answer for Dr. Hofer and never file anything on their own.

/** A document the request service can file: a lab result or a rehab discharge report. */
export type FileableDocument = LabResult | RehabReport;

/** The sender as ID Austria names them. `gdaOid` is the eHVD OID from `urn:eidgvat:attributes.gda`, if the token had one. */
export type Sender = { givenName: string; familyName: string; gdaOid: string | null };

/** The input of `checkRelease` in `src/server/ehvd/release-check.ts` (T15, #44). */
export type ReleaseCheckInput = {
  document: FileableDocument;
  /** The organisation the request went to, as Dr. Hofer typed it. */
  org: string;
  sender: Sender;
};

/** An eHVD entry. Only its OID matters here; `GdaDescriptor` from the eHVD client (T15) has it. */
type EhvdEntry = { id: { id: string } };

/**
 * The result of `checkRelease`: the release check from docs/IDENTITY.md, "Who may release a document". Anything the
 * eHVD does not confirm, an unreachable eHVD included, is a hold, and the answer waits for Dr. Hofer.
 */
export type ReleaseCheckResult =
  /** `practitioner` is the responsible person's entry, `organisation` the organisation's. */
  | { verdict: "pass"; via: "claim" | "search"; practitioner: EhvdEntry; organisation: EhvdEntry }
  /** `sentence` goes into the held notice, for example "The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße." */
  | { verdict: "hold"; reason: string; sentence: string };

export type ReleaseCheck = (input: ReleaseCheckInput) => Promise<ReleaseCheckResult>;

/** Until the eHVD client (T15) lands, nobody is confirmed, so every answer is held. Never a pass. */
export const releaseCheckNotConnected: ReleaseCheck = async () => ({
  verdict: "hold",
  reason: "ehvd_unreachable",
  sentence: "The eHVD release check is not connected yet, so ordy could not confirm who released the document.",
});

export type AnswerToFile = {
  request: RequestRow;
  document: FileableDocument;
  /** Dr. Hofer, from the request's display name. */
  requester: Person;
  /** The outside person who logged in and sent the answer. */
  sender: Person;
  /** The responsible person when it is someone other than the sender, for example Dr. Leitner for Stefan Kern. */
  author: Person | null;
  organisation: OrganizationParty;
  /** The sender's ID token exactly as received, for the Provenance signature. */
  idToken: string;
  /** When the sender pressed send. */
  sentAt: Date;
  /** SHA-256 of the upload. With the request id it identifies the answer, so filing it again files nothing new. */
  uploadSha256: string;
  /** True when Dr. Hofer accepted a held answer. */
  acceptedByRequester: boolean;
  /** Extra sentences for the Provenance narrative, for example the outcome of the release check. */
  findings: string[];
};

/** An answer as `kept_answers` stores it, in JSON. */
export type KeptAnswer = Omit<AnswerToFile, "request" | "sentAt"> & { sentAt: string };

/** The FHIR server has not filed the answer, for certain: the Bundle was never sent, or the server refused it. */
export class NotFiled extends Error {}

/**
 * Files one answer as one FHIR transaction: all of it or nothing. Filing the same answer again (same request and upload
 * hash) files nothing new and returns the same ids. `sender` in the result also goes into the `bindings` table.
 *
 * Throws NotFiled when the server certainly has nothing. Any other error leaves it open whether the server filed the
 * answer, for example a timeout (docs/FHIR.md, "Retries").
 *
 * It writes no audit entry; the answer flow writes `answer_filed` in the database transaction that sets the request to
 * `filed`. `fhirFiling` in `fhir-filing.ts` is the real one.
 */
export type FileAnswer = (answer: AnswerToFile) => Promise<AnswerFiled>;

/** The references the clinical resources point at: `MapContext` in the FHIR mappers (#10). */
export type ClinicalContext = { patient: Reference; organization: Reference; practitioner: Reference | null };

/**
 * The clinical resources of one answer: `mapLabResult` (T12) or `mapRehabReport` (T14) from `src/server/fhir/mappers.ts`
 * (#30), in the shape the filing Bundle takes.
 */
export type MapClinical = (document: FileableDocument, context: ClinicalContext, filedAt: Date) => AnswerFiling["clinical"];

/** Until the mappers (#10) land, filing fails, and the request stays as it was. */
export const mapClinicalNotConnected: MapClinical = () => {
  throw new Error("The FHIR mappers are not connected yet (T12, T14)");
};
