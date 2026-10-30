import { eq } from "drizzle-orm";

import { DOCUMENT_TYPES } from "@/lib/document-types";
import { auditActor, recordAudit } from "@/server/audit/record";
import type { EidSession } from "@/server/auth/eid-session";
import type { Db, Tx } from "@/server/db";
import { heldAnswers, keptAnswers } from "@/server/db/schema";
import { parseDocument } from "@/server/documents/parse";
import { checkAnswerPatient, patientMismatch, uploadHash } from "@/server/documents/patient-check";
import type { PersonLine } from "@/server/documents/types";
import { TransitionError } from "@/server/requests/lifecycle";
import { applyEvent, findRequestByToken, type RequestRow } from "@/server/requests/service";
import type { AnswerDeps, RequestedPatient } from "./deps";
import { type Filed, fileAndRecord, filedNotice, idTokenPersonNumber, isSender, requesterPerson, responsiblePerson } from "./file";
import { type AnswerToFile, type FileableDocument, NotFiled, type ReleaseCheckResult, type Sender } from "./ports";

// POST /r/{token}/answer (docs/ARCHITECTURE.md, "Outside portal"): `answer_sent`, parse, patient check, release check,
// then file and `answer_filed`, or hold for Dr. Hofer. The uploader learns only what they can act on.

/** The scenario documents are about 2 KB. A larger upload is not a document from a lab or a rehab clinic. */
export const MAX_UPLOAD_BYTES = 512 * 1024;

export type AnswerUpload = {
  /** The link token from the page URL. The session alone is not enough, so another site cannot post an answer. */
  token: string;
  session: EidSession;
  file: Uint8Array;
  /** The patient's name and birth date as the sender typed them. */
  form: { name: string; birthDate: string };
};

/**
 * What the sender sees.
 * - `filed`: on the FHIR server. `held`: Dr. Hofer decides first. Both end the answer.
 * - `patient_mismatch`: the document (`part: "document"`) or the typed name and birth date are about someone else.
 * - `unreadable`: reasons the sender can fix, then upload again.
 * - `not_filed`: not filed yet. The FHIR server refused it, or its outcome is unknown and the answer is kept, so the
 *   next send files that answer again (docs/FHIR.md, "Retries").
 * - `login_again`: the login is not the one the request is bound to any more.
 * - `closed`: the link does not work for this session (wrong person, wrong request, or no longer `verified`).
 */
export type AnswerOutcome =
  | { outcome: "filed" }
  | { outcome: "held" }
  | { outcome: "patient_mismatch"; part: "document" | "form" }
  | { outcome: "unreadable"; errors: string[] }
  | { outcome: "not_filed" }
  | { outcome: "login_again" }
  | { outcome: "closed" };

const CLOSED: AnswerOutcome = { outcome: "closed" };
const unreadable = (...errors: string[]): AnswerOutcome => ({ outcome: "unreadable", errors });

/** The request accepts an answer from this session: the link's request, still `verified`, bound to this person. */
export const answersFor = (request: RequestRow | null, session: EidSession): request is RequestRow =>
  request?.id === session.requestId && request.state === "verified" && !!request.personNumber && request.personNumber === session.personNumber;

/** Only UTF-8 text. The parser would read a binary file as nonsense. */
function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The release check never passes by accident: a thrown error, an unreachable eHVD included, holds the answer. */
async function releaseCheck(deps: AnswerDeps, document: FileableDocument, sender: Sender, request: RequestRow): Promise<ReleaseCheckResult> {
  try {
    return await deps.releaseCheck({ document, org: request.org, sender });
  } catch (error) {
    console.error(`release check for request ${request.id} failed:`, error instanceof Error ? error.message : error);
    return { verdict: "hold", reason: "ehvd_unreachable", sentence: "The eHVD could not be reached to confirm who released the document." };
  }
}

/** An earlier answer is kept because its filing outcome is unknown, so it goes first (docs/FHIR.md, "Retries"). */
class KeptFirst extends Error {}

const hasKeptAnswer = async (db: Db | Tx, requestId: number) =>
  (await db.select({ requestId: keptAnswers.requestId }).from(keptAnswers).where(eq(keptAnswers.requestId, requestId))).length > 0;

/**
 * Files with `answer_confirmed`, or files the kept answer again when there is one. `build` is null when the kept
 * answer is all there is; if it is gone by then, nothing is filed and the sender tries again.
 */
async function fileConfirmed(
  deps: AnswerDeps,
  request: RequestRow,
  patient: RequestedPatient,
  build: ((locked: RequestRow, knownPractitioner: string | null) => Omit<AnswerToFile, "request">) | null,
): Promise<AnswerOutcome> {
  const noAnswer = () => {
    throw new NotFiled("The kept answer was filed or dropped in between");
  };
  let filed: Filed | null;
  try {
    filed = await fileAndRecord(deps, request.id, "answer_confirmed", build ?? noAnswer);
  } catch (error) {
    // The message only: a FHIR error body could echo the document.
    console.error(`filing the answer to request ${request.id} failed:`, error instanceof Error ? error.message : error);
    return { outcome: "not_filed" };
  }
  if (!filed) return CLOSED;
  await deps.notify(filed.request, filedNotice(filed, patient.display));
  return { outcome: "filed" };
}

/** The Provenance sentence for a passed release check. */
const releaseFinding = (responsible: PersonLine, org: string, via: "claim" | "search") =>
  `The eHVD confirms ${[...responsible.titles, responsible.given, responsible.family].filter(Boolean).join(" ")} as responsible for the content at ${org}${
    via === "claim" ? ", found by the eHVD OID in the ID Austria login" : ", found by name"
  }.`;

export async function submitAnswer(deps: AnswerDeps, upload: AnswerUpload): Promise<AnswerOutcome> {
  const { db } = deps;
  const { session } = upload;
  const sentAt = new Date();
  const request = await findRequestByToken(db, upload.token);
  if (!answersFor(request, session)) return CLOSED;
  // The Provenance carries the bound person's own login. A token of anyone else is never filed.
  const idToken = request.idToken;
  if (!idToken || idTokenPersonNumber(idToken) !== session.personNumber) return { outcome: "login_again" };

  const sha256 = uploadHash(upload.file);
  const size = upload.file.byteLength;
  const actor = auditActor({ kind: "eid", session });
  await recordAudit(db, { event: "answer_sent", requestId: request.id, actor, outcome: "received", detail: { sha256, size } });

  // While an earlier answer may be on the FHIR server, this upload is not read, and the earlier answer is filed again.
  if (await hasKeptAnswer(db, request.id)) return fileConfirmed(deps, request, await deps.readPatient(request.patientId), null);

  if (size > MAX_UPLOAD_BYTES) return unreadable(`The file is larger than ${MAX_UPLOAD_BYTES / 1024} KB. Upload the document as Markdown or text.`);
  const markdown = decodeText(upload.file);
  if (markdown === null) return unreadable("The file is not a text file. Upload the document as Markdown or text.");
  const parsed = parseDocument(markdown);
  if (!parsed.ok) return unreadable(...parsed.errors);
  const doc = parsed.document;

  const patient = await deps.readPatient(request.patientId);
  const check = checkAnswerPatient(doc.patient, upload.form, patient);
  if (!check.pass) {
    // docs/IDENTITY.md, M3: nothing is filed, the upload is discarded, only its hash and which part did not match stay.
    try {
      await applyEvent(db, request.id, "patient_mismatch", (tx) =>
        recordAudit(tx, {
          event: "misdelivery_caught",
          requestId: request.id,
          actor,
          outcome: "patient_mismatch",
          detail: { sha256, size, ...patientMismatch(doc.patient, upload.form, patient) },
        }).then(() => undefined),
      );
    } catch (error) {
      if (error instanceof TransitionError) return CLOSED;
      throw error;
    }
    await deps.notify(request, { kind: "patient-mismatch", requestId: request.id, patient: patient.display });
    return { outcome: "patient_mismatch", part: check.document ? "form" : "document" };
  }

  if (doc.type !== request.docType) {
    const wanted = DOCUMENT_TYPES[request.docType].messageName;
    return unreadable(`This request asks for a ${wanted}. The heading of your document says "${doc.kind}".`);
  }

  const sender: Sender = { givenName: session.givenName, familyName: session.familyName, gdaOid: session.gdaOid };
  const responsible = responsiblePerson(doc);
  const release = await releaseCheck(deps, doc, sender, request);

  if (release.verdict === "hold" || !responsible) {
    const reason = release.verdict === "hold" ? release.sentence : "The document names nobody responsible for its content.";
    // docs/IDENTITY.md, "Block or hold": the right person answered, so keep the answer and let Dr. Hofer decide.
    try {
      await applyEvent(db, request.id, "answer_unconfirmed", async (tx) => {
        // An upload at the same time may have been kept in between; it goes first.
        if (await hasKeptAnswer(tx, request.id)) throw new KeptFirst();
        const held = { markdown, sha256, sender, idToken, reason, sentAt };
        await tx
          .insert(heldAnswers)
          .values({ requestId: request.id, ...held })
          .onConflictDoUpdate({ target: heldAnswers.requestId, set: held });
      });
    } catch (error) {
      if (error instanceof TransitionError) return CLOSED;
      if (error instanceof KeptFirst) return { outcome: "not_filed" };
      throw error;
    }
    await deps.notify(request, { kind: "held", requestId: request.id, hold: "answer", reason });
    return { outcome: "held" };
  }

  // A pass found the responsible person in the eHVD. Through the login's OID that is the sender; by name, it is the
  // sender only if the names match, as for Dr. Brandl, and otherwise someone else, as Dr. Leitner for Stefan Kern.
  const authorIsSender = release.via === "claim" || isSender(responsible, sender);
  const responsibleOid = release.practitioner.id.id;
  return fileConfirmed(deps, request, patient, (locked, knownPractitioner) => ({
    document: doc,
    requester: requesterPerson(locked.requesterName),
    sender: {
      given: sender.givenName,
      family: sender.familyName,
      ehvdOid: authorIsSender ? responsibleOid : sender.gdaOid,
      practitionerId: knownPractitioner,
      ...(authorIsSender ? { titles: responsible.titles } : {}),
    },
    author: authorIsSender ? null : { titles: responsible.titles, given: responsible.given, family: responsible.family, ehvdOid: responsibleOid },
    organisation: { name: locked.org, ehvdOid: release.organisation.id.id },
    idToken,
    sentAt,
    uploadSha256: sha256,
    acceptedByRequester: false,
    findings: [releaseFinding(responsible, locked.org, release.via)],
  }));
}
