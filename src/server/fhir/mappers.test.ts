import assert from "node:assert/strict";
import { test } from "node:test";

import { labResultMaria, labResultMax, rehabReportMaria } from "@/server/documents/scenario-fixtures";

import { type MapContext, mapLabResult, mapRehabReport } from "./mappers";

const context: MapContext = {
  patient: "Patient/maria-beispiel",
  organization: "urn:uuid:organization",
  practitioner: "urn:uuid:practitioner",
};

const decode = (data: string | undefined) => Buffer.from(data ?? "", "base64").toString("utf8");

const UUID_URN = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const aptt = labResultMaria.rows[1];
const seconds = (value: number) => ({ value, unit: "s", system: "http://unitsofmeasure.org", code: "s" });

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

test("mapLabResult builds the DiagnosticReport around the Observations", () => {
  const { diagnosticReport, observations } = mapLabResult(labResultMaria, context);
  const { presentedForm, ...rest } = diagnosticReport.resource;
  assert.match(diagnosticReport.fullUrl, UUID_URN);
  for (const o of observations) assert.match(o.fullUrl, UUID_URN);
  assert.equal(new Set(observations.map((o) => o.fullUrl)).size, 4);
  assert.deepEqual(rest, {
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
  });
  assert.equal(presentedForm?.length, 1);
  assert.equal(presentedForm?.[0].contentType, "text/markdown; charset=utf-8");
  assert.equal(decode(presentedForm?.[0].data), labResultMaria.markdown);
});

test("mapLabResult gives every resource its own reference objects", () => {
  const { diagnosticReport, observations } = mapLabResult(labResultMaria, context);
  const subjects = [diagnosticReport, ...observations].map((e) => e.resource.subject);
  assert.equal(new Set(subjects).size, 5);
});

test("mapLabResult passes the parser's H for Max Beispiel's raised INR and aPTT through", () => {
  const codes = mapLabResult(labResultMax, context).observations.map((o) => o.resource.interpretation?.[0].coding?.[0].code);
  assert.deepEqual(codes, ["H", "H", "N", "N"]);
});

test("mapLabResult leaves out the physician and the conclusion when the document has none", () => {
  const { diagnosticReport, observations } = mapLabResult(
    { ...labResultMaria, conclusion: null, validatedBy: null },
    { ...context, practitioner: null },
  );
  assert.equal("resultsInterpreter" in diagnosticReport.resource, false);
  assert.equal("conclusion" in diagnosticReport.resource, false);
  assert.equal("performer" in observations[0].resource, false);
});

test("mapLabResult keeps only the text of a range the parser could not split", () => {
  const row = { ...aptt, low: null, high: null, rangeText: "below 37", interpretation: null };
  const [observation] = mapLabResult({ ...labResultMaria, rows: [row] }, context).observations;
  assert.equal("interpretation" in observation.resource, false);
  assert.deepEqual(observation.resource.referenceRange, [{ text: "below 37" }]);
});

test("mapLabResult leaves out the elements of empty cells", () => {
  const row = { ...aptt, test: "", low: null, high: null, rangeText: "", interpretation: null };
  const [observation] = mapLabResult({ ...labResultMaria, rows: [row] }, context).observations;
  assert.equal("referenceRange" in observation.resource, false);
  assert.deepEqual(observation.resource.code, { coding: [{ system: "http://loinc.org", code: "14979-9" }] });
});

test("mapLabResult keeps zero values and zero bounds", () => {
  const row = { ...aptt, value: 0, valueText: "0", low: 0, high: 2, rangeText: "0 to 2" };
  const [observation] = mapLabResult({ ...labResultMaria, rows: [row] }, context).observations;
  assert.deepEqual(observation.resource.valueQuantity, seconds(0));
  assert.deepEqual(observation.resource.referenceRange, [{ low: seconds(0), high: seconds(2), text: "0 to 2" }]);
});

test("mapRehabReport builds the DocumentReference from docs/FHIR.md", () => {
  const { fullUrl, resource } = mapRehabReport(rehabReportMaria, context, "2026-10-29T14:02:12+01:00");
  const { content, ...rest } = resource;
  assert.match(fullUrl, UUID_URN);
  assert.deepEqual(rest, {
    resourceType: "DocumentReference",
    status: "current",
    docStatus: "final",
    type: { coding: [{ system: "http://loinc.org", code: "18842-5" }], text: "Rehab discharge report" },
    subject: { reference: "Patient/maria-beispiel" },
    date: "2026-10-29T14:02:12+01:00",
    author: [{ reference: "urn:uuid:practitioner" }, { reference: "urn:uuid:organization" }],
    description: "rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt",
    context: { period: { start: "2026-09-02", end: "2026-09-23" } },
  });
  assert.equal(content.length, 1);
  assert.equal(content[0].attachment.contentType, "text/markdown; charset=utf-8");
  assert.equal(content[0].attachment.title, "Reha Waldblick: discharge report");
  assert.equal(decode(content[0].attachment.data), rehabReportMaria.markdown);
});

test("mapRehabReport names only the organisation when no physician wrote the report", () => {
  const { resource } = mapRehabReport(
    { ...rehabReportMaria, reason: null, writtenBy: null },
    { ...context, practitioner: null },
    "2026-10-29T14:02:12+01:00",
  );
  assert.deepEqual(resource.author, [{ reference: "urn:uuid:organization" }]);
  assert.equal("description" in resource, false);
});

test("mapRehabReport refuses a filing time that is not an instant", () => {
  for (const filedAt of ["2026-10-29T14:02+01:00", "2026-10-29T14:02:12", "2026-10-29"]) {
    assert.throws(() => mapRehabReport(rehabReportMaria, context, filedAt), /is not an instant/);
  }
});
