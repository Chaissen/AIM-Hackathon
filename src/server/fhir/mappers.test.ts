import assert from "node:assert/strict";
import { test } from "node:test";

import { labResultMaria, labResultMax, rehabReportMaria } from "@/server/documents/scenario-fixtures";

import { type MapContext, mapLabResult, mapRehabReport } from "./mappers";

const context: MapContext = {
  patient: { reference: "Patient/maria-beispiel" },
  organization: { reference: "urn:uuid:organization" },
  practitioner: { reference: "urn:uuid:practitioner" },
};

const decode = (data: string | undefined) => Buffer.from(data ?? "", "base64").toString("utf8");

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
    valueQuantity: { value: 31, unit: "s", system: "http://unitsofmeasure.org", code: "s" },
    interpretation: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "N" }] }],
    referenceRange: [
      {
        low: { value: 25, unit: "s", system: "http://unitsofmeasure.org", code: "s" },
        high: { value: 37, unit: "s", system: "http://unitsofmeasure.org", code: "s" },
        text: "25 to 37",
      },
    ],
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
  const report = diagnosticReport.resource;
  assert.match(diagnosticReport.fullUrl, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.deepEqual(report.code, { coding: [{ system: "http://loinc.org", code: "11502-2" }], text: "Labor Kanalstraße: lab report" });
  assert.deepEqual(report.category, [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB" }] }]);
  assert.deepEqual(report.performer, [context.organization]);
  assert.deepEqual(report.resultsInterpreter, [context.practitioner]);
  assert.deepEqual(
    report.result,
    observations.map((o) => ({ reference: o.fullUrl })),
  );
  assert.equal(new Set(observations.map((o) => o.fullUrl)).size, 4);
  assert.equal(report.conclusion, "All values are within the reference range.");
  assert.equal(report.presentedForm?.[0].contentType, "text/markdown");
  assert.equal(decode(report.presentedForm?.[0].data), labResultMaria.markdown);
});

test("mapLabResult marks Max Beispiel's raised INR and aPTT with H", () => {
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

test("mapLabResult leaves out the interpretation and missing range bounds", () => {
  const row = { ...labResultMaria.rows[1], low: null, high: 37, interpretation: null };
  const [observation] = mapLabResult({ ...labResultMaria, rows: [row] }, context).observations;
  assert.equal("interpretation" in observation.resource, false);
  assert.deepEqual(observation.resource.referenceRange, [
    { high: { value: 37, unit: "s", system: "http://unitsofmeasure.org", code: "s" }, text: "25 to 37" },
  ]);
});

test("mapRehabReport builds the DocumentReference from docs/FHIR.md", () => {
  const { fullUrl, resource } = mapRehabReport(rehabReportMaria, context, "2026-10-29T14:02:12+01:00");
  const { content, ...rest } = resource;
  assert.match(fullUrl, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.deepEqual(rest, {
    resourceType: "DocumentReference",
    status: "current",
    docStatus: "final",
    type: { coding: [{ system: "http://loinc.org", code: "18842-5" }], text: "Rehab discharge report" },
    subject: { reference: "Patient/maria-beispiel" },
    date: "2026-10-29T14:02:12+01:00",
    author: [context.practitioner, context.organization],
    description: "rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt",
    context: { period: { start: "2026-09-02", end: "2026-09-23" } },
  });
  assert.equal(content.length, 1);
  assert.equal(content[0].attachment.contentType, "text/markdown");
  assert.equal(content[0].attachment.title, "Reha Waldblick: discharge report");
  assert.equal(decode(content[0].attachment.data), rehabReportMaria.markdown);
});

test("mapRehabReport names only the organisation when no physician wrote the report", () => {
  const { resource } = mapRehabReport(
    { ...rehabReportMaria, reason: null, writtenBy: null },
    { ...context, practitioner: null },
    "2026-10-29T14:02:12+01:00",
  );
  assert.deepEqual(resource.author, [context.organization]);
  assert.equal("description" in resource, false);
});
