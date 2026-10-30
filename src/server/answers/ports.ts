import type { LabResult, PersonLine, RehabReport } from "@/server/documents/types";
import type { RequestRow } from "@/server/requests/service";

// What the answer flow needs from the eHVD release check (T15, #11) and from the filing (T12 to T14, #10 and #12).
// Both are passed in, so the flow runs and is tested before they land. Until then the defaults below hold every answer
// for Dr. Hofer and never file anything on their own.

/** A document the request service can file: a lab result or a rehab discharge report. */
export type FileableDocument = LabResult | RehabReport;

/** The sender as ID Austria names them. `gdaOid` is the eHVD OID from `urn:eidgvat:attributes.gda`, if the token had one. */
export type Sender = { givenName: string; familyName: string; gdaOid: string | null };

export type ReleaseCheckInput = {
  docType: FileableDocument["type"];
  /** The person under `Validated by` (lab result) or `Written by` (rehab report). */
  responsible: PersonLine;
  /** True when the responsible person has the sender's name. Then the eHVD OID from the login identifies them. */
  responsibleIsSender: boolean;
  sender: Sender;
  /** The organisation the request names, as Dr. Hofer typed it. */
  organisation: string;
};

/**
 * The release check from docs/IDENTITY.md, "Who may release a document". Anything other than a confirmation, an
 * unreachable eHVD included, is `unconfirmed`, and the answer waits for Dr. Hofer.
 */
export type ReleaseCheckResult =
  | {
      result: "confirmed";
      /** The eHVD OIDs of the responsible person and the organisation, for the Practitioner and Organization. */
      responsibleOid: string;
      organisationOid: string;
      /** One sentence for the Provenance narrative, for example "eHVD lists her as an active lab physician at Labor Kanalstraße." */
      finding: string;
    }
  | {
      result: "unconfirmed";
      /** The reason sentence of the held notice, for example "The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße." */
      reason: string;
    };

export type ReleaseCheck = (input: ReleaseCheckInput) => Promise<ReleaseCheckResult>;

/** Until the eHVD client (T15) lands, nobody is confirmed, so every answer is held. Never a pass. */
export const releaseCheckNotConnected: ReleaseCheck = async () => ({
  result: "unconfirmed",
  reason: "The eHVD release check is not connected yet, so ordy could not confirm who released the document.",
});

/** A person for the Practitioner, in the shape of `Person` in the filing (T13). */
export type FilingPerson = {
  given: string;
  family: string;
  titles?: string[];
  /** The eHVD OID, or null when the eHVD does not list the person or was not asked. */
  ehvdOid: string | null;
  /** For a person without an eHVD entry: the Practitioner the `bindings` table remembers from an earlier answer. */
  practitionerId?: string | null;
};

export type AnswerToFile = {
  request: RequestRow;
  document: FileableDocument;
  /** Dr. Hofer, from the request's display name. */
  requester: FilingPerson;
  /** The outside person who logged in and sent the answer. */
  sender: FilingPerson;
  /** The responsible person when it is someone other than the sender, for example Dr. Leitner for Stefan Kern. */
  author: FilingPerson | null;
  organisation: { name: string; ehvdOid: string | null };
  /** The sender's ID token exactly as received, for the Provenance signature. */
  idToken: string;
  /** When the sender pressed send. */
  sentAt: Date;
  /** True when Dr. Hofer accepted a held answer. */
  acceptedByRequester: boolean;
  /** Extra sentences for the Provenance narrative, for example the outcome of the release check. */
  findings: string[];
};

/** The server ids of a filed answer, for `answer_filed` and the `bindings` table. */
export type FiledAnswer = {
  /** Every resource the transaction created or reused, for example `DiagnosticReport/12`. */
  resources: string[];
  /** For example `Provenance/17`. */
  provenance: string;
  /** The sender's Practitioner, for example `Practitioner/9`. */
  sender: string;
};

/**
 * Files one answer as one FHIR transaction: all of it or nothing. Throws when the FHIR server refuses it.
 * It writes no audit entry; the answer flow writes `answer_filed` in the transaction that sets the request to `filed`.
 */
export type FileAnswer = (answer: AnswerToFile) => Promise<FiledAnswer>;

/** Until the mappers (#10) and the filing (#12) land, filing fails, and the request stays as it was. */
export const fileAnswerNotConnected: FileAnswer = async () => {
  throw new Error("Filing is not connected yet (T12 to T14)");
};
