import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseDocument } from "./parse";
import type { ParsedDocument } from "./types";

const scenario = (name: string) => readFileSync(new URL(`../../../track/scenario/documents/${name}`, import.meta.url), "utf8");

function parsed(markdown: string): ParsedDocument {
  const result = parseDocument(markdown);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.document;
}

function refused(markdown: string, reason: RegExp) {
  const result = parseDocument(markdown);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, reason);
}

test("reads Maria Beispiel's lab result", () => {
  const doc = parsed(scenario("lab-result-maria-beispiel.md"));
  assert.equal(doc.type, "lab-result");
  if (doc.type !== "lab-result") return;
  assert.equal(doc.org, "Labor Kanalstraße");
  assert.equal(doc.kind, "lab report");
  assert.deepEqual(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" });
  assert.equal(doc.sampleTaken, "2026-10-22T08:10:00+02:00");
  assert.equal(doc.reported, "2026-10-22T11:40:00+02:00");
  assert.equal(doc.conclusion, "All values are within the reference range.");
  assert.deepEqual(doc.validatedBy, { name: "Dr. Eva Brandl", role: "lab physician" });
  assert.deepEqual(doc.rows, [
    { test: "INR (prothrombin time)", loinc: "6301-6", value: 1, range: { low: 0.8, high: 1.2, text: "0.8 to 1.2" } },
    { test: "aPTT", loinc: "14979-9", value: 31, unit: "s", range: { low: 25, high: 37, text: "25 to 37" } },
    { test: "Platelets", loinc: "777-3", value: 245, unit: "10*9/L", range: { low: 150, high: 400, text: "150 to 400" } },
    { test: "Fibrinogen", loinc: "3255-7", value: 3.1, unit: "g/L", range: { low: 2, high: 4, text: "2.0 to 4.0" } },
  ]);
  assert.equal(doc.markdown, scenario("lab-result-maria-beispiel.md"));
});

test("reads Max Beispiel's lab result with his own patient line", () => {
  const doc = parsed(scenario("lab-result-max-beispiel.md"));
  assert.equal(doc.type, "lab-result");
  assert.deepEqual(doc.patient, { name: "Max Beispiel", birthDate: "1960-01-01" });
});

test("reads Maria Beispiel's rehab report", () => {
  const doc = parsed(scenario("rehab-report-maria-beispiel.md"));
  assert.equal(doc.type, "rehab-report");
  if (doc.type !== "rehab-report") return;
  assert.equal(doc.org, "Reha Waldblick");
  assert.deepEqual(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" });
  assert.deepEqual(doc.stay, { start: "2026-09-02", end: "2026-09-23" });
  assert.match(doc.reason ?? "", /^rehabilitation after a total hip replacement/);
  assert.deepEqual(doc.writtenBy, { name: "Dr. Johanna Leitner", role: "medical director", org: "Reha Waldblick" });
  assert.deepEqual(doc.sentBy, { name: "Stefan Kern", role: "discharge management" });
  assert.deepEqual(
    doc.sections.map((s) => s.heading),
    ["Course", "Medication at discharge", "Recommendations"],
  );
  assert.match(doc.sections[1].text, /^- Rivaroxaban 10 mg/);
  assert.doesNotMatch(doc.sections[2].text, /Written by/);
});

const rehab = (stay: string) => `# Reha Waldblick: discharge report\n\nPatient: Maria Beispiel, born 12 March 1961\nStay: ${stay}\n\nWritten by: Dr. Johanna Leitner\n`;

test("reads a stay across two months", () => {
  const doc = parsed(rehab("28 August to 12 September 2026"));
  assert.ok(doc.type === "rehab-report");
  assert.deepEqual(doc.stay, { start: "2026-08-28", end: "2026-09-12" });
  assert.equal(doc.sentBy, undefined);
});

test("reads an unknown document kind as a generic document", () => {
  const doc = parsed("# Praxis Dr. Muster: referral letter\n\nPatient: Maria Beispiel, born 12 March 1961\n\n## Findings\n\nNothing unusual.\n");
  assert.equal(doc.type, "generic");
  assert.equal(doc.kind, "referral letter");
  assert.deepEqual(doc.sections, [{ heading: "Findings", text: "Nothing unusual." }]);
});

const lab = (rows: string, header = "| Test | Result | Unit | Reference range | LOINC code |") =>
  `# Labor Kanalstraße: lab report\n\nPatient: Maria Beispiel, born 12 March 1961\nSample taken: 3 November 2026, 07:45\nReported: 3 November 2026, 09:00\n\n${header}\n|---|---|---|---|---|\n${rows}\n\nValidated by: Dr. Eva Brandl\n`;

test("uses the winter offset after the clock change and keeps ranges it cannot split as text", () => {
  const doc = parsed(lab("| CRP | 4,5 | mg/L | below 5 | 1988-5 |"));
  assert.ok(doc.type === "lab-result");
  assert.equal(doc.sampleTaken, "2026-11-03T07:45:00+01:00");
  assert.deepEqual(doc.rows, [{ test: "CRP", loinc: "1988-5", value: 4.5, unit: "mg/L", range: { text: "below 5" } }]);
  assert.equal(doc.conclusion, undefined);
});

test("refuses documents it cannot read completely", () => {
  refused("Patient: Maria Beispiel, born 12 March 1961\n", /no heading/);
  refused("# Labor Kanalstraße\n\nPatient: Maria Beispiel, born 12 March 1961\n", /document kind/);
  refused("# Labor Kanalstraße: lab report\n\nSample taken: 3 November 2026, 07:45\n", /"Patient" line/);
  refused("# Labor Kanalstraße: lab report\n\nPatient: Maria Beispiel, born 1961-03-12\n", /birth date/);
  refused(lab("| CRP | positive | | | 1988-5 |"), /not a number/);
  refused(lab("| CRP | 4.5 | mg/L | 0 to 5 | CRP |"), /LOINC/);
  refused(lab("| CRP | 4.5 | mg/L | 0 to 5 | 1988-5 |", "| Test | Value | Unit | Reference range | LOINC code |"), /column "result"/);
  refused(lab("| CRP | 4.5 | mg/L | 0 to 5 | 1988-5 |").replace("Validated by: Dr. Eva Brandl\n", ""), /"Validated by"/);
  refused(rehab("2 to 23 Septober 2026"), /"Stay"/);
});

test("refuses a document with two patient lines", () => {
  refused(
    "# Labor Kanalstraße: lab report\n\nPatient: Maria Beispiel, born 12 March 1961\n\nPatient: Max Beispiel, born 1 January 1960\n",
    /more than one "Patient"/,
  );
});
