import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseDate, parseStay, parseViennaDateTime } from "./dates";
import { parseDocument, parsePersonLine } from "./parse";
import type { LabResult, ParsedDocument, RehabReport } from "./types";

const scenario = (file: string) => readFileSync(new URL(`../../../track/scenario/documents/${file}`, import.meta.url), "utf8");

function parsed(markdown: string): ParsedDocument {
  const result = parseDocument(markdown);
  assert.ok(result.ok, result.ok ? "" : result.errors.join("; "));
  return result.document;
}

test("Maria's lab result parses into four rows", () => {
  const doc = parsed(scenario("lab-result-maria-beispiel.md")) as LabResult;
  assert.equal(doc.type, "lab-result");
  assert.equal(doc.organisation, "Labor Kanalstraße");
  assert.equal(doc.kind, "lab report");
  assert.deepEqual(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" });
  assert.equal(doc.sampleTaken, "2026-10-22T08:10:00+02:00");
  assert.equal(doc.reported, "2026-10-22T11:40:00+02:00");
  assert.equal(doc.conclusion, "All values are within the reference range.");
  assert.deepEqual(doc.validatedBy, { raw: "Dr. Eva Brandl, lab physician", titles: ["Dr."], given: "Eva", family: "Brandl", details: ["lab physician"] });
  assert.equal(doc.fields["Requested by"], "Dr. Lena Hofer, Klinikum Beispielstadt");
  assert.deepEqual(
    doc.rows.map((r) => [r.test, r.value, r.ucum, r.low, r.high, r.loinc, r.interpretation]),
    [
      ["INR (prothrombin time)", 1, null, 0.8, 1.2, "6301-6", "N"],
      ["aPTT", 31, "s", 25, 37, "14979-9", "N"],
      ["Platelets", 245, "10*9/L", 150, 400, "777-3", "N"],
      ["Fibrinogen", 3.1, "g/L", 2, 4, "3255-7", "N"],
    ],
  );
  assert.equal(doc.rows[0].valueText, "1.0");
  assert.equal(doc.rows[2].unitText, "10^9/L");
  assert.equal(doc.markdown, scenario("lab-result-maria-beispiel.md"));
});

test("Max's lab result parses, with INR and aPTT above the range", () => {
  const doc = parsed(scenario("lab-result-max-beispiel.md")) as LabResult;
  assert.deepEqual(doc.patient, { name: "Max Beispiel", birthDate: "1960-01-01" });
  assert.deepEqual(
    doc.rows.map((r) => [r.test, r.value, r.interpretation]),
    [
      ["INR (prothrombin time)", 2.6, "H"],
      ["aPTT", 44, "H"],
      ["Platelets", 198, "N"],
      ["Fibrinogen", 3.4, "N"],
    ],
  );
});

test("Maria's rehab report parses with stay, sections and both people", () => {
  const doc = parsed(scenario("rehab-report-maria-beispiel.md")) as RehabReport;
  assert.equal(doc.type, "rehab-report");
  assert.equal(doc.organisation, "Reha Waldblick");
  assert.deepEqual(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" });
  assert.deepEqual(doc.stay, { start: "2026-09-02", end: "2026-09-23" });
  assert.match(doc.reason ?? "", /^rehabilitation after a total hip replacement on the left/);
  assert.deepEqual(
    doc.sections.map((s) => s.heading),
    ["Course", "Medication at discharge", "Recommendations"],
  );
  assert.match(doc.sections[1].text, /^- Rivaroxaban 10 mg once a day/);
  assert.equal(doc.sections[1].text.split("\n").length, 3);
  // "Written by" and "Sent by" stand after the last section and still count as fields.
  assert.doesNotMatch(doc.sections[2].text, /Written by|Sent by/);
  assert.deepEqual(doc.writtenBy, {
    raw: "Dr. Johanna Leitner, medical director, Reha Waldblick",
    titles: ["Dr."],
    given: "Johanna",
    family: "Leitner",
    details: ["medical director", "Reha Waldblick"],
  });
  assert.deepEqual(doc.sentBy, { raw: "Stefan Kern, discharge management", titles: [], given: "Stefan", family: "Kern", details: ["discharge management"] });
});

test("an unknown kind becomes a generic document", () => {
  const doc = parsed("# Praxis Dr. Huber: referral letter\n\nPatient: Maria Beispiel, born 12 March 1961\n\nPlease see the attached findings.\n");
  assert.equal(doc.type, "other");
  assert.equal(doc.kind, "referral letter");
  assert.equal(doc.organisation, "Praxis Dr. Huber");
});

test("Windows and Unix line endings parse the same", () => {
  // The checkout may already have CRLF (git core.autocrlf on Windows), so build both variants from LF.
  const lf = scenario("lab-result-maria-beispiel.md").replace(/\r\n/g, "\n");
  const fromLf = parsed(lf) as LabResult;
  const fromCrlf = parsed(lf.replace(/\n/g, "\r\n")) as LabResult;
  assert.equal(fromLf.rows.length, 4);
  assert.deepEqual({ ...fromCrlf, markdown: "" }, { ...fromLf, markdown: "" });
});

test("documents the parser cannot read come back with reasons, not exceptions", () => {
  const cases: [string, RegExp][] = [
    ["Just some text without a heading.", /no heading/],
    ["# Labor Kanalstraße: lab report\n\nSample taken: 22 October 2026, 08:10\n", /no line such as "Patient:/],
    ["# Labor Kanalstraße: lab report\n\nPatient: Maria Beispiel, born 31 February 1961\n", /needs a name and a birth date/],
    ["# Labor Kanalstraße: lab report\n\nPatient: Maria Beispiel, born 12 March 1961\nSample taken: yesterday\nReported: 22 October 2026, 11:40\n", /"Sample taken: yesterday" is not a date/],
    ["# Labor Kanalstraße: lab report\n\nPatient: Maria Beispiel, born 12 March 1961\nSample taken: 22 October 2026, 08:10\nReported: 22 October 2026, 11:40\n", /no result table/],
    ["# Reha Waldblick: discharge report\n\nPatient: Maria Beispiel, born 12 March 1961\nStay: September\n", /"Stay: September" is not a stay/],
  ];
  for (const [markdown, reason] of cases) {
    const result = parseDocument(markdown);
    assert.equal(result.ok, false, markdown);
    if (!result.ok) assert.match(result.errors.join(" "), reason);
  }
});

test("a lab row with a result that is not a number is reported with its row", () => {
  const markdown = scenario("lab-result-maria-beispiel.md").replace("| aPTT | 31 |", "| aPTT | pending |");
  const result = parseDocument(markdown);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.errors, ['Row 2 (aPTT): the result "pending" is not a number.']);
});

test("dates in Europe/Vienna get the right offset in summer and in winter", () => {
  assert.equal(parseViennaDateTime("22 October 2026, 08:10"), "2026-10-22T08:10:00+02:00");
  // Summer time ends on 25 October 2026 (docs/FHIR.md, validator traps).
  assert.equal(parseViennaDateTime("26 October 2026, 08:10"), "2026-10-26T08:10:00+01:00");
  assert.equal(parseViennaDateTime("29 March 2026, 03:30"), "2026-03-29T03:30:00+02:00");
  assert.equal(parseViennaDateTime("1 January 2027, 0:05"), "2027-01-01T00:05:00+01:00");
  assert.equal(parseViennaDateTime("22 October 2026"), null);
  assert.equal(parseViennaDateTime("22 October 2026, 25:00"), null);
  assert.equal(parseDate("1 January 1960"), "1960-01-01");
  assert.equal(parseDate("29 February 2025"), null);
  assert.equal(parseDate("12 Mars 1961"), null);
});

test("stays name the month once, twice, or cross a year", () => {
  assert.deepEqual(parseStay("2 to 23 September 2026"), { start: "2026-09-02", end: "2026-09-23" });
  assert.deepEqual(parseStay("28 August to 12 September 2026"), { start: "2026-08-28", end: "2026-09-12" });
  assert.deepEqual(parseStay("28 December to 3 January 2027"), { start: "2026-12-28", end: "2027-01-03" });
  assert.deepEqual(parseStay("28 December 2026 to 3 January 2027"), { start: "2026-12-28", end: "2027-01-03" });
  assert.equal(parseStay("23 to 2 September 2026"), null);
  assert.equal(parseStay("September 2026"), null);
});

test("person lines split titles, given and family names, and details", () => {
  assert.deepEqual(parsePersonLine("Univ.-Prof. Dr. Eva Maria Brandl-Huber, lab physician"), {
    raw: "Univ.-Prof. Dr. Eva Maria Brandl-Huber, lab physician",
    titles: ["Univ.-Prof.", "Dr."],
    given: "Eva Maria",
    family: "Brandl-Huber",
    details: ["lab physician"],
  });
});
