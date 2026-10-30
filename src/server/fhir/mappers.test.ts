import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiagnosticReport, DocumentReference, FhirResource, Observation } from "fhir/r4";

import type { DocumentType } from "@/lib/document-types";
import { labResultMaria, labResultMax, rehabReportMaria } from "@/server/documents/scenario-fixtures";
import type { LabRow, ParsedDocument } from "@/server/documents/types";

import { buildFilingBundle, ID_AUSTRIA_SIMULATION, prepareParties, type AnswerFiling, type Parties } from "./filing";
import { type MapContext, mapLabResult, mapRehabReport } from "./mappers";

const context: MapContext = {
  patient: { reference: "Patient/maria-beispiel" },
  organization: { reference: "urn:uuid:organization" },
  practitioner: { reference: "urn:uuid:practitioner" },
};

const filedAt = new Date("2026-10-29T13:02:12Z");

const UUID_URN = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const aptt = labResultMaria.rows[1];
const seconds = (value: number) => ({ value, unit: "s", system: "http://unitsofmeasure.org", code: "s" });
const markdownAttachment = (doc: ParsedDocument) => ({
  contentType: "text/markdown; charset=utf-8",
  data: Buffer.from(doc.markdown, "utf8").toString("base64"),
});
/** A row whose cells are empty apart from the result and the LOINC code. */
const emptyCells: LabRow = { ...aptt, test: "", ucum: null, unitText: "", low: null, high: null, rangeText: "", interpretation: null };
const withRow = (row: LabRow) => mapLabResult({ ...labResultMaria, rows: [row] }, context).observations[0].resource;

/** Paths of every null, blank string, empty array, or empty object, which FHIR JSON does not allow (`ele-1`). */
function emptyValues(value: unknown, path = "$"): string[] {
  if (value === null || (typeof value === "string" && !value.trim())) return [path];
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => emptyValues(v, `${path}[${i}]`)) : [path];
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? entries.flatMap(([k, v]) => emptyValues(v, `${path}.${k}`)) : [path];
  }
  return [];
}

test("mapLabResult builds the aPTT Observation exactly as in docs/FHIR.md", () => {
  const { observations } = mapLabResult(labResultMaria, context);
  assert.deepEqual(observations[1].resource, {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
    code: { coding: [{ system: "http://loinc.org", code: "14979-9" }], text: "aPTT" },
    subject: { reference: "Patient/maria-beispiel" },
    effectiveDateTime: "2026-10-22T08:10:00+02:00",
    issued: "2026-10-22T11:40:00+02:00",
    performer: [{ reference: "urn:uuid:practitioner" }],
    valueQuantity: seconds(31),
    interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "N" }] }],
    referenceRange: [{ low: seconds(25), high: seconds(37), text: "25 to 37" }],
  });
});

test("mapLabResult gives INR values without a unit and platelets in UCUM", () => {
  const [inr, , platelets] = mapLabResult(labResultMaria, context).observations.map((o) => o.resource);
  assert.deepEqual(inr.valueQuantity, { value: 1 });
  assert.deepEqual(inr.referenceRange, [{ low: { value: 0.8 }, high: { value: 1.2 }, text: "0.8 to 1.2" }]);
  assert.equal(platelets.valueQuantity?.code, "10*9/L");
  assert.equal(platelets.valueQuantity?.unit, "10^9/L");
});

test("mapLabResult keeps a unit the parser could not code in UCUM as text only", () => {
  const observation = withRow({ ...aptt, ucum: null, unitText: "G/L", value: 6.5, low: 4, high: 10, rangeText: "4 to 10" });
  assert.deepEqual(observation.valueQuantity, { value: 6.5, unit: "G/L" });
  assert.deepEqual(observation.referenceRange, [{ low: { value: 4, unit: "G/L" }, high: { value: 10, unit: "G/L" }, text: "4 to 10" }]);
});

test("mapLabResult files a vital sign in a lab table with the profile's category and code", () => {
  const categories = (o: { category?: { coding?: { code?: string }[] }[] }) => o.category?.map((c) => c.coding?.[0].code);
  const sO2 = withRow({ ...aptt, test: "sO2", loinc: "2708-6", ucum: "%", unitText: "%" });
  assert.deepEqual(categories(sO2), ["laboratory", "vital-signs"]);
  assert.deepEqual(sO2.code?.coding, [{ system: "http://loinc.org", code: "2708-6" }]);
  // 2713-6 counts as sO2, so the validator also wants the profile's code 2708-6.
  const calculated = withRow({ ...aptt, test: "sO2 (calculated)", loinc: "2713-6", ucum: "%", unitText: "%" });
  assert.deepEqual(calculated.code?.coding, [
    { system: "http://loinc.org", code: "2713-6" },
    { system: "http://loinc.org", code: "2708-6" },
  ]);
  assert.deepEqual(categories(withRow(aptt)), ["laboratory"]);
});

test("mapLabResult builds the DiagnosticReport around the Observations", () => {
  const { diagnosticReport, observations } = mapLabResult(labResultMaria, context);
  assert.match(diagnosticReport.fullUrl, UUID_URN);
  for (const o of observations) assert.match(o.fullUrl, UUID_URN);
  assert.equal(new Set(observations.map((o) => o.fullUrl)).size, 4);
  assert.deepEqual(diagnosticReport.resource, {
    resourceType: "DiagnosticReport",
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB" }] }],
    code: { coding: [{ system: "http://loinc.org", code: "11502-2" }], text: "Labor Kanalstraße: lab report" },
    subject: { reference: "Patient/maria-beispiel" },
    effectiveDateTime: "2026-10-22T08:10:00+02:00",
    issued: "2026-10-22T11:40:00+02:00",
    performer: [{ reference: "urn:uuid:organization" }],
    resultsInterpreter: [{ reference: "urn:uuid:practitioner" }],
    result: observations.map((o) => ({ reference: o.fullUrl })),
    conclusion: "All values are within the reference range.",
    presentedForm: [markdownAttachment(labResultMaria)],
  });
});

test("mapLabResult gives every resource its own reference objects", () => {
  const { diagnosticReport, observations } = mapLabResult(labResultMaria, context);
  const report = diagnosticReport.resource;
  const references = [
    report.subject,
    report.performer?.[0],
    report.resultsInterpreter?.[0],
    ...observations.flatMap((o) => [o.resource.subject, o.resource.performer?.[0]]),
  ];
  assert.ok(references.every(Boolean));
  assert.equal(new Set([...references, ...Object.values(context)]).size, references.length + 3);
});

test("mapLabResult passes the parser's H for Max Beispiel's raised INR and aPTT through", () => {
  const codes = mapLabResult(labResultMax, context).observations.map((o) => o.resource.interpretation?.[0].coding?.[0].code);
  assert.deepEqual(codes, ["H", "H", "N", "N"]);
});

test("mapLabResult leaves out a missing conclusion", () => {
  const { diagnosticReport } = mapLabResult({ ...labResultMaria, conclusion: null }, context);
  assert.equal("conclusion" in diagnosticReport.resource, false);
});

test("mapLabResult keeps only the text of a range the parser could not split", () => {
  const observation = withRow({ ...aptt, low: null, high: null, rangeText: "below 37", interpretation: null });
  assert.equal("interpretation" in observation, false);
  assert.deepEqual(observation.referenceRange, [{ text: "below 37" }]);
});

test("mapLabResult leaves out the elements of empty cells", () => {
  const observation = withRow(emptyCells);
  assert.equal("referenceRange" in observation, false);
  assert.deepEqual(observation.code, { coding: [{ system: "http://loinc.org", code: "14979-9" }] });
  assert.deepEqual(observation.valueQuantity, { value: 31 });
});

test("mapLabResult keeps zero values and zero bounds", () => {
  const observation = withRow({ ...aptt, value: 0, valueText: "0", low: 0, high: 2, rangeText: "0 to 2" });
  assert.deepEqual(observation.valueQuantity, seconds(0));
  assert.deepEqual(observation.referenceRange, [{ low: seconds(0), high: seconds(2), text: "0 to 2" }]);
});

test("no mapper output carries an empty value", () => {
  const outputs = [
    mapLabResult(labResultMaria, context),
    mapLabResult(labResultMax, context),
    mapLabResult({ ...labResultMaria, conclusion: null, rows: [emptyCells] }, context),
    // Two empty `##` headings give a conclusion of one space.
    mapLabResult({ ...labResultMaria, conclusion: " " }, context),
    mapLabResult({ ...labResultMaria, rows: [{ ...emptyCells, unitText: "G/L", rangeText: "below 37" }] }, context),
    mapRehabReport(rehabReportMaria, context, filedAt),
    mapRehabReport({ ...rehabReportMaria, reason: null }, context, filedAt),
  ];
  assert.deepEqual(emptyValues(JSON.parse(JSON.stringify(outputs))), []);
});

test("mapRehabReport builds the DocumentReference from docs/FHIR.md", () => {
  const { fullUrl, resource } = mapRehabReport(rehabReportMaria, context, filedAt);
  assert.match(fullUrl, UUID_URN);
  assert.deepEqual(resource, {
    resourceType: "DocumentReference",
    status: "current",
    docStatus: "final",
    type: { coding: [{ system: "http://loinc.org", code: "18842-5" }], text: "Rehab discharge report" },
    subject: { reference: "Patient/maria-beispiel" },
    date: "2026-10-29T14:02:12+01:00",
    author: [{ reference: "urn:uuid:practitioner" }, { reference: "urn:uuid:organization" }],
    description: "rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt",
    content: [{ attachment: { ...markdownAttachment(rehabReportMaria), title: "Reha Waldblick: discharge report" } }],
    context: { period: { start: "2026-09-02", end: "2026-09-23" } },
  });
});

test("mapRehabReport gives the DocumentReference its own reference objects", () => {
  const { resource } = mapRehabReport(rehabReportMaria, context, filedAt);
  const references = [resource.subject, ...(resource.author ?? [])];
  assert.equal(references.length, 3);
  assert.equal(new Set([...references, ...Object.values(context)]).size, references.length + 3);
});

test("mapRehabReport leaves out a missing reason", () => {
  const { resource } = mapRehabReport({ ...rehabReportMaria, reason: null }, context, filedAt);
  assert.equal("description" in resource, false);
});

// The mappers inside the filing (T13): prepareParties(), then the mapper, then the transaction Bundle.

const ISSUER = "http://localhost:8080/realms/idaustria-sim";
const patient = { reference: "Patient/maria-beispiel" };
const hofer = { given: "Lena", family: "Hofer", titles: ["Dr."], ehvdOid: "1.2.40.0.34.3.2.99.1.1" };
const idAustria = { name: ID_AUSTRIA_SIMULATION, issuer: ISSUER };

// The filing only decodes the ID token, so an unsigned one is enough.
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const idToken = `${part({ alg: "RS256" })}.${part({ iss: ISSUER, iat: Date.parse("2026-10-29T13:01:40Z") / 1000 })}.c2lnbmF0dXJl`;

const labParties: Parties = {
  requester: hofer,
  sender: { given: "Eva", family: "Brandl", titles: ["Dr."], ehvdOid: "1.2.40.0.34.3.2.99.1.2" },
  author: null,
  organization: { name: "Labor Kanalstraße", ehvdOid: "1.2.40.0.34.3.1.99.1.2" },
  identityProvider: idAustria,
};

const rehabParties: Parties = {
  requester: hofer,
  sender: { given: "Stefan", family: "Kern", ehvdOid: null },
  author: { given: "Johanna", family: "Leitner", titles: ["Dr."], ehvdOid: "1.2.40.0.34.3.2.99.1.3" },
  organization: { name: "Reha Waldblick", ehvdOid: "1.2.40.0.34.3.1.99.1.3" },
  identityProvider: idAustria,
};

function fileAnswer(docType: DocumentType, parties: Parties, map: (context: MapContext) => AnswerFiling["clinical"]) {
  const prepared = prepareParties(parties, { requestId: 1, uploadSha256: "a".repeat(64) });
  const clinical = map({ patient, organization: prepared.organization, practitioner: prepared.author });
  const request = { id: 1, docType, patient, createdAt: new Date("2026-10-29T12:58:00Z"), expiresAt: new Date("2026-11-05T12:58:00Z") };
  const { bundle } = buildFilingBundle({ request, parties, prepared, clinical, idToken, sentAt: new Date("2026-10-29T13:02:00Z"), filedAt, acceptedByRequester: false, fhirBaseUrl: "http://localhost:8090/fhir" });
  const entries = bundle.entry ?? [];
  /** The fullUrl of the entry whose resource carries this OID. */
  const byOid = (oid: string) => entries.find((e) => JSON.stringify(e.resource).includes(`urn:oid:${oid}`))?.fullUrl;
  const ofType = <T extends FhirResource>(type: T["resourceType"]) => entries.flatMap((e) => (e.resource?.resourceType === type ? [e.resource as T] : []));
  return { bundle, entries, byOid, ofType };
}

/** Every `reference` in the value that points into the Bundle. */
function uuidReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(uuidReferences);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => (k === "reference" && typeof v === "string" && v.startsWith("urn:uuid:") ? [v] : uuidReferences(v)));
}

test("a lab answer files the mapper output in one Bundle whose references all resolve", () => {
  const { bundle, entries, byOid, ofType } = fileAnswer("lab-result", labParties, (context) => {
    const { diagnosticReport, observations } = mapLabResult(labResultMaria, context);
    return { output: diagnosticReport, others: observations };
  });
  const fullUrls = new Set(entries.map((e) => e.fullUrl));
  const references = uuidReferences(bundle);
  assert.ok(references.length > 0);
  for (const reference of references) assert.ok(fullUrls.has(reference), reference);
  assert.deepEqual(emptyValues(JSON.parse(JSON.stringify(bundle))), []);

  const [report] = ofType<DiagnosticReport>("DiagnosticReport");
  const observations = ofType<Observation>("Observation");
  assert.equal(observations.length, 4);
  // Dr. Brandl sent and wrote the report, so she is performer and interpreter; the lab performs the report.
  const brandl = byOid("1.2.40.0.34.3.2.99.1.2");
  assert.ok(brandl);
  assert.deepEqual(report.resultsInterpreter, [{ reference: brandl }]);
  assert.deepEqual(report.performer, [{ reference: byOid("1.2.40.0.34.3.1.99.1.2") }]);
  for (const o of observations) assert.deepEqual(o.performer, [{ reference: brandl }]);
});

test("a rehab answer names the author and the clinic of the filing as the DocumentReference's authors", () => {
  const { bundle, entries, byOid, ofType } = fileAnswer("rehab-report", rehabParties, (context) => ({
    output: mapRehabReport(rehabReportMaria, context, filedAt),
    others: [],
  }));
  const fullUrls = new Set(entries.map((e) => e.fullUrl));
  for (const reference of uuidReferences(bundle)) assert.ok(fullUrls.has(reference), reference);
  assert.deepEqual(emptyValues(JSON.parse(JSON.stringify(bundle))), []);

  const [document] = ofType<DocumentReference>("DocumentReference");
  // Dr. Leitner wrote the report; Stefan Kern only sent it.
  assert.deepEqual(document.author, [
    { reference: byOid("1.2.40.0.34.3.2.99.1.3") },
    { reference: byOid("1.2.40.0.34.3.1.99.1.3") },
  ]);
});
