import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { eq, inArray, like, sql } from "drizzle-orm";
import type { DiagnosticReport, DocumentReference, Observation, Practitioner, Provenance, Task } from "fhir/r4";
import { UnsecuredJWT } from "jose";

import { eidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { auditLog, bindings, heldAnswers, requests } from "@/server/db/schema";
import { parseDocument } from "@/server/documents/parse";
import { capabilities, FhirError, fhirFetch } from "@/server/fhir/client";
import type { AnswerFiled } from "@/server/fhir/file-answer";
import { applyEvent, applyLoginTransition, createRequest, getRequest, saveIdToken, type NewRequest, type RequestRow } from "@/server/requests/service";
import type { AnswerDeps } from "./deps";
import { fhirFiling, mapClinical } from "./fhir-filing";
import { type AnswerToFile, NotFiled, type ReleaseCheckInput, type ReleaseCheckResult } from "./ports";
import { submitAnswer } from "./submit";

// Requests 1 and 2 from the upload to the HAPI server from FHIR_BASE_URL, through the mappers (T12, T14) and the
// filing (T13). The eHVD is a stand-in here; `src/server/ehvd/release-check.test.ts` covers the real one. The patient is the demo's Maria Beispiel; everything else is this run's. Deletes its rows and what it filed afterwards. Skipped when Postgres or
// HAPI is not running.
const unreachable = await Promise.all([db.execute(sql`select 1`), capabilities(AbortSignal.timeout(3000))]).then(
  () => false,
  () => "Postgres or HAPI is not reachable, start them with ./scripts/setup.sh",
);

const doc = (file: string) => new Uint8Array(readFileSync(new URL(`../../../track/scenario/documents/${file}`, import.meta.url)));
const maria = { name: "Maria Beispiel", birthDate: "1961-03-12" };
const run = randomBytes(4).toString("hex");

// Below the synthetic eHVD entries from docs/EHVD.md, with an arc of this run, so the Practitioners and Organizations
// this test files and deletes are never the demo's.
const arc = `.${randomBytes(4).readUInt32BE()}`;
const OID = {
  brandl: `1.2.40.0.34.3.2.99.1.2${arc}`,
  leitner: `1.2.40.0.34.3.2.99.1.3${arc}`,
  lab: `1.2.40.0.34.3.1.99.1.2${arc}`,
  rehab: `1.2.40.0.34.3.1.99.1.3${arc}`,
};
const EVA = { givenName: "Eva", familyName: "Brandl", personNumber: `GH:test-eva-${run}`, gdaOid: OID.brandl };
const STEFAN = { givenName: "Stefan", familyName: "Kern", personNumber: `GH:test-stefan-${run}`, gdaOid: null };

const created: number[] = [];
const filedResources: string[] = [];

after(async () => {
  // Newest first, so nothing still references a resource when it is deleted. A party another answer uses stays.
  for (const reference of filedResources.reverse()) await fhirFetch(reference, { method: "DELETE" }).catch(() => {});
  await Promise.all(created.map((id) => fhirFetch(`Task/ordy-request-${id}`, { method: "DELETE" }).catch(() => {})));
  if (!unreachable && created.length) {
    await db.delete(auditLog).where(inArray(auditLog.requestId, created));
    await db.delete(heldAnswers).where(inArray(heldAnswers.requestId, created));
    await db.delete(requests).where(inArray(requests.id, created));
    await db.delete(bindings).where(like(bindings.personNumber, `GH:test-%-${run}`));
  }
  await db.$client.end();
});

const idTokenOf = (personNumber: string) =>
  new UnsecuredJWT({ "urn:pvpgvat:oidc.bpk": personNumber, "urn:pvpgvat:oidc.eid_ida_level": "urn:eidgvat:eid.status.full" })
    .setIssuer("http://localhost:8080/realms/idaustria-sim")
    .setIssuedAt()
    .encode();

/** A request to a scenario organisation in `verified`, as the login (T07, T08) leaves it. */
async function verifiedRequest(person: typeof EVA | typeof STEFAN, docType: NewRequest["docType"], org: string) {
  const { request, token } = await createRequest(
    db,
    {
      docType,
      patientId: "maria-beispiel",
      given: person.givenName,
      family: person.familyName,
      org: `${org} test ${run}`,
      channel: "email",
      address: "someone@example.org",
      requester: "@lena.hofer:klinikum.example",
      requesterName: "Dr. Lena Hofer",
    },
    { passed: true },
  );
  created.push(request.id);
  assert.ok(await applyLoginTransition(db, request.id, { from: "sent", to: "verified", personNumber: person.personNumber }));
  await saveIdToken(db, request.id, idTokenOf(person.personNumber));
  const session = eidSession.parse({ requestId: request.id, level: "urn:eidgvat:eid.status.full", ...person });
  return { request, token, session };
}

/** A pass as `checkRelease` (T15) returns it for the scenario: Dr. Brandl through her login's OID, Dr. Leitner by name. */
const confirmed = async ({ sender, document }: ReleaseCheckInput): Promise<ReleaseCheckResult> => ({
  verdict: "pass",
  via: sender.gdaOid ? "claim" : "search",
  practitioner: { id: { id: document.type === "lab-result" ? OID.brandl : OID.leitner } },
  organisation: { id: { id: document.type === "lab-result" ? OID.lab : OID.rehab } },
  senderIsResponsible: sender.gdaOid !== null,
});

function deps() {
  const file = fhirFiling({ mapClinical });
  const answers: AnswerToFile[] = [];
  const value: AnswerDeps = {
    db,
    readPatient: async () => ({ family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12", display: "Maria Beispiel" }),
    releaseCheck: confirmed,
    fileAnswer: async (answer) => {
      answers.push(answer);
      const filed = await file(answer);
      filedResources.push(...filed.resources.filter((reference) => !filedResources.includes(reference)));
      return filed;
    },
    notify: async () => {},
  };
  return { deps: value, answers, file };
}

async function filedDetail(requestId: number): Promise<AnswerFiled> {
  const entries = await db.select().from(auditLog).where(eq(auditLog.requestId, requestId));
  const filed = entries.filter((entry) => entry.event === "answer_filed");
  assert.equal(filed.length, 1, "answer_filed is recorded once");
  return filed[0].detail as AnswerFiled;
}

const oidOf = (practitioner: Practitioner) => practitioner.identifier?.find((id) => id.value?.startsWith("urn:oid:"))?.value;

test("request 1: Dr. Brandl's lab result is filed with her eHVD entry and her login", { skip: unreachable }, async () => {
  const { request, token, session } = await verifiedRequest(EVA, "lab-result", "Labor Kanalstraße");
  const { deps: value, answers, file } = deps();

  const outcome = await submitAnswer(value, { token, session, file: doc("lab-result-maria-beispiel.md"), form: maria });

  assert.deepEqual(outcome, { outcome: "filed" });
  assert.equal((await getRequest(db, request.id))?.state, "filed");
  const detail = await filedDetail(request.id);
  assert.match(detail.output, /^DiagnosticReport\//);
  assert.equal(detail.author, detail.sender, "she sent and validated it");

  const report = await fhirFetch<DiagnosticReport>(detail.output);
  assert.equal(report.subject?.reference, "Patient/maria-beispiel", "the patient comes from the request");
  assert.equal(report.performer?.[0]?.reference, detail.organization, "the laboratory performed the tests");
  assert.equal(report.resultsInterpreter?.[0]?.reference, detail.author, "Dr. Brandl validated them");
  assert.equal(report.result?.length, 4, "one Observation per result row");
  const [first] = await Promise.all((report.result ?? []).slice(0, 1).map((ref) => fhirFetch<Observation>(ref.reference ?? "")));
  assert.equal(first.subject?.reference, "Patient/maria-beispiel");
  assert.equal(oidOf(await fhirFetch<Practitioner>(detail.sender)), `urn:oid:${OID.brandl}`);
  const provenance = await fhirFetch<Provenance>(detail.provenance);
  assert.deepEqual(provenance.target.map((target) => target.reference), detail.targets, "the report and its Observations");
  assert.equal(detail.targets.length, 5);
  assert.deepEqual(provenance.agent.map((agent) => agent.type?.coding?.[0]?.code), ["author"], "no informant when the sender is the author");
  assert.equal(Buffer.from(provenance.signature?.[0]?.data ?? "", "base64").toString(), answers[0].idToken, "signed with her own login");
  const task = await fhirFetch<Task>(detail.task);
  assert.equal(task.status, "completed");
  assert.equal(task.output?.[0]?.valueReference?.reference, detail.output);

  // A retry with the same answer, for example after a lost response, files nothing new and gets the same ids.
  const again = await file(answers[0]);
  assert.equal(again.output, detail.output);
  assert.equal(again.provenance, detail.provenance);
});

test("request 2: Stefan Kern sends Dr. Leitner's discharge report", { skip: unreachable }, async () => {
  const { request, token, session } = await verifiedRequest(STEFAN, "rehab-report", "Reha Waldblick");
  const { deps: value } = deps();

  const outcome = await submitAnswer(value, { token, session, file: doc("rehab-report-maria-beispiel.md"), form: maria });

  assert.deepEqual(outcome, { outcome: "filed" });
  const detail = await filedDetail(request.id);
  assert.match(detail.output, /^DocumentReference\//);
  const report = await fhirFetch<DocumentReference>(detail.output);
  assert.equal(report.author?.[0]?.reference, detail.author, "Dr. Leitner is the first author");
  assert.notEqual(detail.author, detail.sender, "Dr. Leitner wrote it, Stefan Kern sent it");

  assert.equal(oidOf(await fhirFetch<Practitioner>(detail.author)), `urn:oid:${OID.leitner}`);
  assert.equal(oidOf(await fhirFetch<Practitioner>(detail.sender)), undefined, "the eHVD does not list Stefan Kern");
  const provenance = await fhirFetch<Provenance>(detail.provenance);
  const agents = provenance.agent.map((agent) => [agent.type?.coding?.[0]?.code, agent.who.reference]);
  assert.deepEqual(agents, [
    ["author", detail.author],
    ["informant", detail.sender],
  ]);

  const [binding] = await db.select().from(bindings).where(eq(bindings.personNumber, STEFAN.personNumber));
  assert.equal(`Practitioner/${binding?.practitionerId}`, detail.sender, "his Practitioner is kept for his next answer");
});

test("the Task follows the request from sent to cancelled", { skip: unreachable }, async () => {
  const { request, token, session } = await verifiedRequest(EVA, "lab-result", "Labor Kanalstraße");
  const task = () => fhirFetch<Task>(`Task/ordy-request-${request.id}`);
  assert.equal((await task()).status, "in-progress", "verified after the login");
  assert.equal((await task()).owner?.display, "Eva Brandl", "the name Dr. Hofer typed, until a Practitioner exists");

  const { deps: value } = deps();
  const max = await submitAnswer(value, { token, session, file: doc("lab-result-max-beispiel.md"), form: maria });
  assert.equal(max.outcome, "patient_mismatch");
  assert.equal((await task()).businessStatus?.text, "waiting for a new upload after a patient mismatch");

  await applyEvent(db, request.id, "cancel");
  assert.equal((await task()).status, "cancelled");
});

/** Request 1's answer without a database: what the filing needs from the request row. */
function sampleAnswer(idToken = idTokenOf(EVA.personNumber)): AnswerToFile {
  const parsed = parseDocument(new TextDecoder().decode(doc("lab-result-maria-beispiel.md")));
  assert.ok(parsed.ok && parsed.document.type === "lab-result");
  const request = { id: 1, docType: "lab-result", patientId: "maria-beispiel", createdAt: new Date(), expiresAt: new Date() } as RequestRow;
  return {
    request,
    document: parsed.document,
    requester: { titles: ["Dr."], given: "Lena", family: "Hofer", ehvdOid: null },
    sender: { titles: ["Dr."], given: "Eva", family: "Brandl", ehvdOid: OID.brandl },
    author: null,
    organisation: { name: "Labor Kanalstraße", ehvdOid: OID.lab },
    idToken,
    sentAt: new Date(),
    uploadSha256: "0".repeat(64),
    acceptedByRequester: false,
    findings: [],
  };
}

test("only a refused or unsent Bundle is NotFiled; a timeout leaves the outcome open", async () => {
  const refused = fhirFiling({ mapClinical, post: () => Promise.reject(new FhirError(422, null)) });
  await assert.rejects(refused(sampleAnswer()), NotFiled);

  const timedOut = fhirFiling({ mapClinical, post: () => Promise.reject(new DOMException("The operation timed out", "TimeoutError")) });
  await assert.rejects(timedOut(sampleAnswer()), (error) => error instanceof DOMException);

  const unmapped = () => {
    throw new Error("no mapper");
  };
  const neverSent = fhirFiling({ mapClinical: unmapped, post: () => assert.fail("nothing is sent") });
  await assert.rejects(neverSent(sampleAnswer()), NotFiled);
  const noIssuer = fhirFiling({ mapClinical, post: () => assert.fail("nothing is sent") });
  await assert.rejects(noIssuer(sampleAnswer(new UnsecuredJWT({}).setIssuedAt().encode())), NotFiled);
});
