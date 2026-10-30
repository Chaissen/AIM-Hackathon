import type { LabResult, RehabReport } from "@/server/documents/types";
import type { ReleaseHoldReason } from "@/server/ehvd/release-check";
import type { AnswerFiled } from "@/server/fhir/file-answer";
import type { AnswerFiling, OrganizationParty, Person } from "@/server/fhir/filing";
import type { MapContext } from "@/server/fhir/mappers";
import type { RequestRow } from "@/server/requests/service";

// What the answer flow needs from the eHVD release check (T15), the FHIR mappers (T12, T14), and the filing (T13).
// They are passed in, so the flow runs and is tested with stand-ins. `answerDeps` in deps.ts passes the real ones.

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

/** An eHVD entry. Only its OID matters here; `GdaDescriptor` from the eHVD client (T15) has it, so `checkRelease` fits. */
type EhvdEntry = { id: { id: string } };

/**
 * The result of `checkRelease`: the release check from docs/IDENTITY.md, "Who may release a document". Anything the
 * eHVD does not confirm, an unreachable eHVD included, is a hold, and the answer waits for Dr. Hofer.
 */
export type ReleaseCheckResult =
  /**
   * `practitioner` is the responsible person's entry, `organisation` the organisation's. `senderIsResponsible`: the
   * login carries the responsible person's name, always so through the claim.
   */
  | { verdict: "pass"; via: "claim" | "search"; practitioner: EhvdEntry; organisation: EhvdEntry; senderIsResponsible: boolean }
  /**
   * `sentence` goes into the held notice, for example "The eHVD does not list Dr. Eva Brandl as a member of Labor
   * Kanalstraße." `organisation` and `practitioner` are what the check found before it held, or null; the
   * practitioner always carries the responsible person's name. Accept files with their OIDs.
   */
  | { verdict: "hold"; reason: ReleaseHoldReason; sentence: string; organisation: EhvdEntry | null; practitioner: EhvdEntry | null };

export type ReleaseCheck = (input: ReleaseCheckInput) => Promise<ReleaseCheckResult>;

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

/**
 * The clinical resources of one answer in the shape the filing Bundle takes. `mapClinical` in `fhir-filing.ts` runs
 * `mapLabResult` (T12) or `mapRehabReport` (T14) from `src/server/fhir/mappers.ts`.
 */
export type MapClinical = (document: FileableDocument, context: MapContext, filedAt: Date) => AnswerFiling["clinical"];
