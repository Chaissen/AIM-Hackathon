import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { inArray, sql } from "drizzle-orm";
import type { DiagnosticReport, DocumentReference } from "fhir/r4";

import { env, mxid } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { db } from "@/server/db";
import { auditLog, heldAnswers, requests } from "@/server/db/schema";
import { labResultMaria, rehabReportMaria } from "@/server/documents/scenario-fixtures";
import type { LabResult, RehabReport } from "@/server/documents/types";
import { capabilities, fhirFetch, put } from "@/server/fhir/client";
import { applyEvent, applyLoginTransition, createRequest, type NewRequest } from "@/server/requests/service";

// Runs against the Postgres from DATABASE_URL and the FHIR server from FHIR_BASE_URL, and deletes what it created there.
const noDb = await db.execute(sql`select 1`).then(
  () => false,
  () => "Postgres is not reachable, start it with ./scripts/setup.sh",
);
const noFhir = noDb || (await capabilities(AbortSignal.timeout(3_000)).then(() => false, () => "the FHIR server is not reachable"));

const hofer = mxid(env.MATRIX_HOFER_USER);
const clinic = createCaller(createContext({ kind: "clinic", mxid: hofer }));
const run = randomBytes(4).toString("hex");
const created: number[] = [];
const filedOnFhir: string[] = [];
const patientId = `ordy-document-test-${run}`;
const filedAt = new Date("2026-10-29T13:02:12.000Z");

after(async () => {
  await Promise.all([...filedOnFhir, ...created.map((id) => `Task/ordy-request-${id}`)].map((ref) => fhirFetch(ref, { method: "DELETE" }).catch(() => {})));
  await fhirFetch(`Patient/${patientId}`, { method: "DELETE" }).catch(() => {});
  if (!noDb && created.length) {
    await db.delete(auditLog).where(inArray(auditLog.requestId, created));
    await db.delete(requests).where(inArray(requests.id, created));
  }
  await db.$client.end();
});

const view = ({ markdown, ...document }: LabResult | RehabReport) => ({ document, original: markdown });

async function newRequest(overrides: Partial<NewRequest> = {}) {
  const { request } = await createRequest(
    db,
    {
      docType: "lab-result",
      patientId: "maria-beispiel",
      given: "Eva",
      family: "Brandl",
      org: "Labor Kanalstraße",
      channel: "email",
      address: "eva.brandl@labor-kanal.example",
      requester: hofer,
      requesterName: "Dr. Lena Hofer",
      ...overrides,
    },
    { passed: true },
    async () => {},
  );
  created.push(request.id);
  return request;
}

async function verifiedRequest(overrides: Partial<NewRequest> = {}) {
  const request = await newRequest(overrides);
  assert.equal(await applyLoginTransition(db, request.id, { from: "sent", to: "verified", personNumber: `GH:document-${run}` }), true);
  return request;
}

/** A filed request whose `answer_filed` names `output` and the request's Task, as the filing writes it. */
async function filedRequest(output: string, overrides: Partial<NewRequest> = {}) {
  const request = await verifiedRequest(overrides);
  assert.equal((await applyEvent(db, request.id, "answer_confirmed"))?.state, "filed");
  const task = `Task/ordy-request-${request.id}`;
  await db.insert(auditLog).values({
    at: filedAt,
    event: "answer_filed",
    requestId: request.id,
    actorKind: "service",
    actor: "ordy",
    outcome: "filed",
    detail: { output, targets: [output], task, resources: [output, task], sha256: "0".repeat(64) },
  });
  return request;
}

function bundleResource<T>(file: string, resourceType: string): T {
  const bundle = JSON.parse(readFileSync(new URL(`../../../../docs/clinical-review/19-fhir/${file}`, import.meta.url), "utf8")) as {
    entry: { resource: { resourceType: string } }[];
  };
  return bundle.entry.find((e) => e.resource.resourceType === resourceType)?.resource as T;
}

/** Posts the report from the clinical review Bundle for the test patient, without the references to its other entries. */
async function postFiled(resource: DiagnosticReport | DocumentReference): Promise<string> {
  const { id } = await fhirFetch<{ id: string }>(resource.resourceType, { method: "POST", body: JSON.stringify(resource) });
  const reference = `${resource.resourceType}/${id}`;
  filedOnFhir.push(reference);
  return reference;
}

test("forRequest shows a held answer to its requester only, and nothing for a request without an answer", { skip: noDb }, async () => {
  const held = await verifiedRequest();
  assert.equal((await applyEvent(db, held.id, "answer_unconfirmed"))?.state, "answer_held");
  const reason = "The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße.";
  const sentAt = new Date("2026-10-29T09:00:00.000Z");
  await db.insert(heldAnswers).values({
    requestId: held.id,
    markdown: labResultMaria.markdown,
    sha256: "1".repeat(64),
    sender: { givenName: "Eva", familyName: "Brandl", gdaOid: null },
    idToken: "unused",
    reason,
    sentAt,
  });
  assert.deepEqual(await clinic.document.forRequest({ id: held.id }), { status: "held", ...view(labResultMaria), sender: "Eva Brandl", reason, sentAt });

  const sent = await newRequest();
  assert.deepEqual(await clinic.document.forRequest({ id: sent.id }), { status: "none" });
  assert.deepEqual(await clinic.document.filedResources({ id: sent.id }), { status: "none" });

  const others = await newRequest({ requester: mxid("max.muster"), requesterName: "Dr. Max Muster" });
  await assert.rejects(clinic.document.forRequest({ id: others.id }), { code: "NOT_FOUND" });
  await assert.rejects(clinic.document.filedResources({ id: others.id }), { code: "NOT_FOUND" });
});

test("a filed answer reads as unavailable while the FHIR server cannot be reached", { skip: noDb }, async () => {
  const request = await filedRequest("DiagnosticReport/1");
  const fhirBaseUrl = env.FHIR_BASE_URL;
  env.FHIR_BASE_URL = "http://127.0.0.1:9/fhir";
  try {
    assert.deepEqual(await clinic.document.forRequest({ id: request.id }), { status: "unavailable", reason: "fhir_unreachable" });
    assert.deepEqual(await clinic.document.filedResources({ id: request.id }), { status: "unavailable", reason: "fhir_unreachable" });
    assert.deepEqual(await clinic.document.forPatient({ patientId: "maria-beispiel" }), { status: "unavailable" });
  } finally {
    env.FHIR_BASE_URL = fhirBaseUrl;
  }
});

test("filed answers read back from the FHIR server, by request and by patient", { skip: noFhir }, async () => {
  await put({ resourceType: "Patient", id: patientId, name: [{ given: ["Test"], family: `Document ${run}` }], birthDate: "1961-03-12" });
  const subject = { reference: `Patient/${patientId}` };
  const lab = bundleResource<DiagnosticReport>("01-request-1-lab-result.bundle.json", "DiagnosticReport");
  const rehab = bundleResource<DocumentReference>("02-request-2-rehab-report.bundle.json", "DocumentReference");
  const { code, effectiveDateTime, issued, conclusion, presentedForm } = lab;
  const report = await postFiled({ resourceType: "DiagnosticReport", status: "final", code, subject, effectiveDateTime, issued, conclusion, presentedForm });
  const { type, date, description, content, context } = rehab;
  const discharge = await postFiled({ resourceType: "DocumentReference", status: "current", type, subject, date, description, content, context });

  const request = await filedRequest(report, { patientId });
  const task = `Task/ordy-request-${request.id}`;
  assert.deepEqual(await clinic.document.forRequest({ id: request.id }), { status: "filed", ...view(labResultMaria), reference: report, filedAt });

  const resources = await clinic.document.filedResources({ id: request.id });
  assert.equal(resources.status, "ok");
  assert.deepEqual(
    resources.status === "ok" && resources.resources.map((r) => [r.reference, r.resourceType, `${r.resource.resourceType}/${r.resource.id}`]),
    [
      [report, "DiagnosticReport", report],
      [task, "Task", task],
    ],
  );
  assert.deepEqual(resources.status === "ok" && resources.resources[0].resource.presentedForm, presentedForm);

  // The report was filed at 13:02:12 UTC, and the discharge report, which no request filed, is dated the same moment.
  // A tie keeps the search order, DiagnosticReport first.
  assert.deepEqual(await clinic.document.forPatient({ patientId }), {
    status: "ok",
    documents: [
      { reference: report, type: "lab-result", title: "Labor Kanalstraße: lab report", date: "2026-10-22T11:40:00+02:00", filedAt, ...view(labResultMaria) },
      { reference: discharge, type: "rehab-report", title: "Reha Waldblick: discharge report", date: "2026-10-29T14:02:12+01:00", filedAt: null, ...view(rehabReportMaria) },
    ],
  });

  const missing = await filedRequest(`DiagnosticReport/ordy-missing-${run}`, { patientId });
  assert.deepEqual(await clinic.document.forRequest({ id: missing.id }), { status: "unavailable", reason: "not_found" });
  assert.deepEqual(await clinic.document.filedResources({ id: missing.id }), { status: "unavailable", reason: "not_found" });
});
