import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";
import { UnsecuredJWT } from "jose";

import { eidSession, type EidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { auditLog, bindings, heldAnswers, keptAnswers, requests } from "@/server/db/schema";
import { uploadHash } from "@/server/documents/patient-check";
import type { Notice } from "@/server/matrix/notices";
import { applyEvent, bindPerson, createRequest, getRequest, type NewRequest, saveIdToken } from "@/server/requests/service";
import type { AnswerDeps } from "./deps";
import { acceptAnswer, rejectAnswer } from "./held";
import { type AnswerToFile, NotFiled, type ReleaseCheckInput, type ReleaseCheckResult } from "./ports";
import { submitAnswer } from "./submit";

// The answer flow against the Postgres from DATABASE_URL, with stand-ins for the FHIR server, the eHVD, and Matrix.
// Deletes its rows afterwards. Skipped when Postgres is not running.
const noDb = await db.execute(sql`select 1`).then(
  () => false,
  () => "Postgres is not reachable, start it with ./scripts/setup.sh",
);

const doc = (file: string) => new Uint8Array(readFileSync(new URL(`../../../track/scenario/documents/${file}`, import.meta.url)));
const LAB_MARIA = doc("lab-result-maria-beispiel.md");
const LAB_MAX = doc("lab-result-max-beispiel.md");
const REHAB_MARIA = doc("rehab-report-maria-beispiel.md");
const maria = { name: "Maria Beispiel", birthDate: "1961-03-12" };

const EVA = { givenName: "Eva", familyName: "Brandl", personNumber: "GH:test-eva", gdaOid: "1.2.40.0.34.3.2.99.1.2" };
const STEFAN = { givenName: "Stefan", familyName: "Kern", personNumber: "GH:test-stefan", gdaOid: null };

const created: number[] = [];
// A unique organisation per request, so the bindings never touch demo data or each other.
const run = randomBytes(4).toString("hex");

after(async () => {
  if (!noDb && created.length) {
    await db.delete(auditLog).where(inArray(auditLog.requestId, created));
    await db.delete(heldAnswers).where(inArray(heldAnswers.requestId, created));
    await db.delete(requests).where(inArray(requests.id, created));
    await db.delete(bindings).where(sql`${bindings.org} like ${`% test ${run} %`}`);
  }
  await db.$client.end();
});

const idTokenOf = (personNumber: string) => new UnsecuredJWT({ "urn:pvpgvat:oidc.bpk": personNumber }).setIssuedAt().encode();

/** A request in `verified`, bound to `person`, with their ID token stored, as the login (T07, T08) leaves it. */
async function verifiedRequest(person: typeof EVA | typeof STEFAN, docType: NewRequest["docType"] = "lab-result") {
  const { request, token } = await createRequest(
    db,
    {
      docType,
      patientId: "maria-beispiel",
      given: person.givenName,
      family: person.familyName,
      org: `${docType === "lab-result" ? "Labor Kanalstraße" : "Reha Waldblick"} test ${run} ${created.length}`,
      channel: "email",
      address: "someone@example.org",
      requester: "@lena.hofer:klinikum.example",
      requesterName: "Dr. Lena Hofer",
    },
    { addressCheckPassed: true },
  );
  created.push(request.id);
  await applyEvent(db, request.id, "identity_pass", (tx) => bindPerson(tx, request.id, person.personNumber));
  const idToken = idTokenOf(person.personNumber);
  await saveIdToken(db, request.id, idToken);
  // `idToken` is the session field before T07 moves the token to the request row; parse drops it afterwards.
  const session: EidSession = eidSession.parse({ requestId: request.id, level: "urn:eidgvat:eid.status.full", idToken: "", ...person });
  return { request, token, session, idToken };
}

/** A pass as `checkRelease` (T15) returns it: through the login's OID for Dr. Brandl, by name for Dr. Leitner. */
const confirmed = (input: ReleaseCheckInput): ReleaseCheckResult => {
  const viaClaim = input.sender.gdaOid !== null;
  return {
    verdict: "pass",
    via: viaClaim ? "claim" : "search",
    // Dr. Brandl and Labor Kanalstraße, or Dr. Leitner and Reha Waldblick, from docs/EHVD.md.
    practitioner: { id: { id: viaClaim ? "1.2.40.0.34.3.2.99.1.2" : "1.2.40.0.34.3.2.99.1.3" } },
    organisation: { id: { id: input.document.type === "lab-result" ? "1.2.40.0.34.3.1.99.1.2" : "1.2.40.0.34.3.1.99.1.3" } },
  };
};

const hold = (sentence: string) => (): ReleaseCheckResult => ({ verdict: "hold", reason: "not_member", sentence });

const FILED = {
  output: "DiagnosticReport/1",
  targets: ["DiagnosticReport/1"],
  provenance: "Provenance/2",
  task: "Task/ordy-request-1",
  sender: "Practitioner/3",
  author: "Practitioner/3",
  organization: "Organization/4",
  resources: ["DiagnosticReport/1", "Provenance/2", "Practitioner/3", "Organization/4", "Task/ordy-request-1"],
};

/** Stand-ins that record what the flow asked for. */
function fakes(release: (input: ReleaseCheckInput) => ReleaseCheckResult | Promise<ReleaseCheckResult> = confirmed) {
  const filed: AnswerToFile[] = [];
  const notices: Notice[] = [];
  const releaseInputs: ReleaseCheckInput[] = [];
  const deps: AnswerDeps = {
    db,
    readPatient: async () => ({ family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12", display: "Maria Beispiel" }),
    releaseCheck: async (input) => {
      releaseInputs.push(input);
      return release(input);
    },
    fileAnswer: async (answer) => {
      filed.push(answer);
      return FILED;
    },
    notify: async (_request, notice) => {
      notices.push(notice);
    },
  };
  return { deps, filed, notices, releaseInputs };
}

const auditOf = (requestId: number) => db.select().from(auditLog).where(eq(auditLog.requestId, requestId)).orderBy(auditLog.id);
const events = async (requestId: number) => (await auditOf(requestId)).map((e) => `${e.event}:${e.outcome}`);
const keptOf = async (requestId: number) => (await db.select().from(keptAnswers).where(eq(keptAnswers.requestId, requestId)))[0];
const bindingOf = async (request: { given: string; family: string; org: string }) =>
  (await db.select().from(bindings).where(and(eq(bindings.given, request.given), eq(bindings.family, request.family), eq(bindings.org, request.org))))[0];

test("request 1: Dr. Brandl's lab result is filed with answer_sent and answer_filed", { skip: noDb }, async () => {
  const { request, token, session, idToken } = await verifiedRequest(EVA);
  const { deps, filed, notices, releaseInputs } = fakes();

  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "filed" });

  assert.equal((await getRequest(db, request.id))?.state, "filed");
  assert.deepEqual(await events(request.id), ["request_sent:sent", "answer_sent:received", "answer_filed:filed"]);
  const [, sent, filedEntry] = await auditOf(request.id);
  assert.equal(sent.actorKind, "outside_person");
  assert.deepEqual(Object.keys(sent.detail).sort(), ["sha256", "size"], "the hash and size only, never the document");
  assert.equal(filedEntry.actor, "ordy");
  assert.deepEqual(filedEntry.detail, FILED);

  assert.deepEqual(releaseInputs[0].sender, { givenName: "Eva", familyName: "Brandl", gdaOid: EVA.gdaOid });
  assert.equal(releaseInputs[0].org, request.org);
  assert.equal(releaseInputs[0].document.type, "lab-result");
  const [answer] = filed;
  assert.equal(answer.author, null, "Dr. Brandl validated it herself, so there is no separate author");
  assert.deepEqual(answer.sender, { given: "Eva", family: "Brandl", ehvdOid: "1.2.40.0.34.3.2.99.1.2", practitionerId: null, titles: ["Dr."] });
  assert.deepEqual(answer.requester, { titles: ["Dr."], given: "Lena", family: "Hofer", ehvdOid: null });
  assert.deepEqual(answer.organisation, { name: request.org, ehvdOid: "1.2.40.0.34.3.1.99.1.2" });
  assert.equal(answer.idToken, idToken, "her own login signs the Provenance");
  assert.equal(answer.acceptedByRequester, false);
  assert.equal(answer.uploadSha256, sent.detail.sha256, "the upload hash identifies the answer for a retry");
  assert.equal(answer.document.type, "lab-result");
  assert.deepEqual(answer.findings, [
    `The eHVD confirms Dr. Eva Brandl as responsible for the content at ${request.org}, found by the eHVD OID in the ID Austria login.`,
  ]);

  assert.deepEqual(notices, [
    { kind: "filed", docType: "lab-result", patient: "Maria Beispiel", sender: "Dr. Eva Brandl", values: { within: 4, outside: 0 } },
  ]);
  const binding = await bindingOf(request);
  assert.equal(binding.personNumber, EVA.personNumber);
  assert.equal(binding.practitionerId, null, "the eHVD lists her, so her OID finds the Practitioner");

  // The link accepts one filed answer.
  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "closed" });
});

test("request 2: Stefan Kern sends the report Dr. Leitner wrote", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(STEFAN, "rehab-report");
  const { deps, filed, notices, releaseInputs } = fakes();

  assert.deepEqual(await submitAnswer(deps, { token, session, file: REHAB_MARIA, form: maria }), { outcome: "filed" });

  assert.equal(releaseInputs[0].sender.gdaOid, null);
  const [answer] = filed;
  assert.deepEqual(answer.author, { titles: ["Dr."], given: "Johanna", family: "Leitner", ehvdOid: "1.2.40.0.34.3.2.99.1.3" });
  assert.deepEqual(answer.sender, { given: "Stefan", family: "Kern", ehvdOid: null, practitionerId: null });
  assert.deepEqual(notices, [{ kind: "filed", docType: "rehab-report", patient: "Maria Beispiel", sender: "Stefan Kern" }]);
  assert.equal((await bindingOf(request)).practitionerId, "3", "not in the eHVD, so the binding remembers his Practitioner");
});

test("M3: Max Beispiel's result is refused, logged as patient_mismatch, and nothing is kept", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  const { deps, filed, notices, releaseInputs } = fakes();

  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MAX, form: maria }), { outcome: "patient_mismatch", part: "document" });

  assert.equal((await getRequest(db, request.id))?.state, "verified", "Dr. Brandl can upload the right file");
  const entries = await auditOf(request.id);
  const caught = entries.find((e) => e.event === "misdelivery_caught");
  assert.equal(caught?.outcome, "patient_mismatch");
  assert.deepEqual(Object.keys(caught?.detail ?? {}).sort(), ["birthDateMatches", "nameMatches", "sha256", "size"]);
  assert.equal(caught?.detail.nameMatches, false);
  assert.equal(caught?.detail.birthDateMatches, false);
  assert.doesNotMatch(JSON.stringify(entries), /Max|1960/, "nothing about the other patient in the audit log");
  assert.equal(filed.length + releaseInputs.length, 0);
  assert.equal((await db.select().from(heldAnswers).where(eq(heldAnswers.requestId, request.id))).length, 0);
  assert.deepEqual(notices, [{ kind: "patient-mismatch", requestId: request.id, patient: "Maria Beispiel" }]);

  // A typo in the form fails too, and says so.
  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: { ...maria, birthDate: "1961-12-03" } }), {
    outcome: "patient_mismatch",
    part: "form",
  });
  // Then the right file and form are filed.
  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "filed" });
});

test("an answer the eHVD does not confirm is held, and Accept files it", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  const reason = "The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße.";
  const { deps, filed, notices } = fakes(hold(reason));

  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "held" });
  assert.equal((await getRequest(db, request.id))?.state, "answer_held");
  assert.equal(filed.length, 0);
  assert.deepEqual(notices, [{ kind: "held", requestId: request.id, hold: "answer", reason }]);
  const [held] = await db.select().from(heldAnswers).where(eq(heldAnswers.requestId, request.id));
  assert.equal(held.reason, reason);
  assert.deepEqual(held.sender, { givenName: "Eva", familyName: "Brandl", gdaOid: EVA.gdaOid });

  // The held answer cannot be replaced from the portal.
  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "closed" });

  const accepted = await acceptAnswer(deps, request.id, "@lena.hofer:klinikum.example");
  assert.equal(accepted?.state, "filed");
  assert.equal(filed[0].acceptedByRequester, true);
  assert.deepEqual(filed[0].organisation, { name: request.org, ehvdOid: null }, "the eHVD confirmed nothing");
  assert.deepEqual(filed[0].findings, [reason]);
  const filedEntry = (await auditOf(request.id)).find((e) => e.event === "answer_filed");
  assert.equal(filedEntry?.detail.acceptedBy, "@lena.hofer:klinikum.example");
  assert.equal((await db.select().from(heldAnswers).where(eq(heldAnswers.requestId, request.id))).length, 0, "filed, so no copy stays");
  assert.equal(notices.at(-1)?.kind, "filed");
  assert.equal(await acceptAnswer(deps, request.id, "@lena.hofer:klinikum.example"), null, "nothing left to accept");
});

test("Reject drops a held answer", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  const { deps } = fakes(hold("Not confirmed."));
  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "held" });

  assert.equal((await rejectAnswer(deps, request.id))?.state, "cancelled");
  assert.equal((await db.select().from(heldAnswers).where(eq(heldAnswers.requestId, request.id))).length, 0);
});

test("a release check that throws holds the answer, never files it", { skip: noDb }, async () => {
  const { token, session } = await verifiedRequest(EVA);
  const { deps, filed, notices } = fakes(() => Promise.reject(new Error("eHVD timeout")));
  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "held" });
  assert.equal(filed.length, 0);
  assert.equal(notices[0].kind, "held");
});

test("only the bound person, with their own login, can answer", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  const { deps, filed } = fakes();

  const thomas = { ...session, personNumber: "GH:test-thomas", givenName: "Thomas", familyName: "Wagner" };
  assert.deepEqual(await submitAnswer(deps, { token, session: thomas, file: LAB_MARIA, form: maria }), { outcome: "closed" });
  assert.deepEqual(
    await submitAnswer(deps, { token, session: { ...session, requestId: request.id + 1 }, file: LAB_MARIA, form: maria }),
    { outcome: "closed" },
    "a session for another request",
  );
  assert.deepEqual(await submitAnswer(deps, { token: "not-a-token", session, file: LAB_MARIA, form: maria }), { outcome: "closed" });
  assert.deepEqual(await events(request.id), ["request_sent:sent"], "nothing logged as an answer");

  // Someone else's login replaced the stored ID token: never sign the Provenance with it.
  await saveIdToken(db, request.id, idTokenOf("GH:test-thomas"));
  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "login_again" });
  assert.equal(filed.length, 0);
});

test("a request that is not verified takes no answer", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  await applyEvent(db, request.id, "cancel");
  assert.deepEqual(await submitAnswer(fakes().deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "closed" });
});

test("unreadable files and the wrong document type are refused with reasons", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  const { deps, filed, notices } = fakes();

  const binary = await submitAnswer(deps, { token, session, file: new Uint8Array([0xff, 0xfe, 0x00, 0x81]), form: maria });
  assert.equal(binary.outcome, "unreadable");

  const noHeading = await submitAnswer(deps, { token, session, file: new TextEncoder().encode("Patient: Maria Beispiel\n"), form: maria });
  assert.equal(noHeading.outcome, "unreadable");

  const rehab = await submitAnswer(deps, { token, session, file: REHAB_MARIA, form: maria });
  assert.deepEqual(rehab, { outcome: "unreadable", errors: ['This request asks for a lab result. The heading of your document says "discharge report".'] });

  assert.equal(filed.length + notices.length, 0);
  assert.equal((await getRequest(db, request.id))?.state, "verified");
  assert.deepEqual((await events(request.id)).filter((e) => e === "answer_sent:received").length, 3, "every upload is logged by its hash");
});

test("when the FHIR server refuses the answer, nothing is kept and the next upload is a new answer", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  const { deps, releaseInputs } = fakes();
  const refusing: AnswerDeps = { ...deps, fileAnswer: () => Promise.reject(new NotFiled("FHIR request failed with 422")) };

  assert.deepEqual(await submitAnswer(refusing, { token, session, file: LAB_MARIA, form: maria }), { outcome: "not_filed" });
  assert.equal((await getRequest(db, request.id))?.state, "verified");
  assert.deepEqual(await events(request.id), ["request_sent:sent", "answer_sent:received"]);
  assert.equal(await bindingOf(request), undefined);
  assert.equal(await keptOf(request.id), undefined);

  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria }), { outcome: "filed" });
  assert.equal(releaseInputs.length, 2, "a new answer gets its own release check");
});

test("an answer whose filing outcome is unknown is kept and filed again exactly as it was", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  const { deps, filed, notices, releaseInputs } = fakes();
  const timingOut: AnswerDeps = { ...deps, fileAnswer: () => Promise.reject(new Error("The operation was aborted due to timeout")) };

  assert.deepEqual(await submitAnswer(timingOut, { token, session, file: LAB_MARIA, form: maria }), { outcome: "not_filed" });
  assert.equal((await getRequest(db, request.id))?.state, "verified");
  const kept = await keptOf(request.id);
  assert.equal(kept?.answer.uploadSha256, uploadHash(LAB_MARIA), "the FHIR server may have it, so it is kept");
  assert.equal(notices.length, 0);

  // Another file is not read while the kept answer may be on the server: not even Max Beispiel's result trips M3.
  assert.deepEqual(await submitAnswer(deps, { token, session, file: LAB_MAX, form: maria }), { outcome: "filed" });
  assert.equal(filed.length, 1);
  assert.equal(filed[0].uploadSha256, uploadHash(LAB_MARIA));
  assert.deepEqual(filed[0].organisation, kept?.answer.organisation);
  assert.equal(filed[0].sentAt.toISOString(), kept?.answer.sentAt);
  assert.equal(releaseInputs.length, 1, "no new eHVD lookup for the retry");
  assert.equal((await getRequest(db, request.id))?.state, "filed");
  assert.equal(await keptOf(request.id), undefined);
  assert.deepEqual(await events(request.id), ["request_sent:sent", "answer_sent:received", "answer_sent:received", "answer_filed:filed"]);
  assert.deepEqual(notices.map((n) => n.kind), ["filed"]);
});

test("a kept answer the FHIR server then refuses is dropped, and Cancel drops one too", { skip: noDb }, async () => {
  const { request, token, session } = await verifiedRequest(EVA);
  const { deps } = fakes();
  const timingOut: AnswerDeps = { ...deps, fileAnswer: () => Promise.reject(new Error("fetch failed")) };
  const refusing: AnswerDeps = { ...deps, fileAnswer: () => Promise.reject(new NotFiled("FHIR request failed with 422")) };

  await submitAnswer(timingOut, { token, session, file: LAB_MARIA, form: maria });
  assert.ok(await keptOf(request.id));
  assert.deepEqual(await submitAnswer(refusing, { token, session, file: LAB_MARIA, form: maria }), { outcome: "not_filed" });
  assert.equal(await keptOf(request.id), undefined, "the server has nothing, so the next upload may be a new answer");

  await submitAnswer(timingOut, { token, session, file: LAB_MARIA, form: maria });
  assert.ok(await keptOf(request.id));
  await applyEvent(db, request.id, "cancel");
  assert.equal(await keptOf(request.id), undefined);
});

test("two uploads at the same time file once", { skip: noDb }, async () => {
  const { token, session } = await verifiedRequest(EVA);
  const { deps, filed } = fakes();
  const results = await Promise.all([1, 2].map(() => submitAnswer(deps, { token, session, file: LAB_MARIA, form: maria })));
  assert.deepEqual(results.map((r) => r.outcome).sort(), ["closed", "filed"]);
  assert.equal(filed.length, 1);
});
