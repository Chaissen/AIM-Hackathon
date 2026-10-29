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

test("a document with a key twice is refused, so a second patient cannot slip past the patient check", () => {
  const maria = scenario("lab-result-maria-beispiel.md").replace(/\r\n/g, "\n");
  const result = parseDocument(maria.replace("\nSample taken:", "\nPatient: Max Beispiel, born 1 January 1960\nSample taken:"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.errors, ['The file has more than one "Patient:" line.']);
  if (!result.ok) assert.deepEqual(result.safety, ["repeated-key"]);

  // A known key inside a section counts too.
  const rehab = scenario("rehab-report-maria-beispiel.md").replace(/\r\n/g, "\n");
  const twice = parseDocument(rehab.replace("## Course\n", "## Course\n\nPatient: Max Beispiel, born 1 January 1960\n"));
  assert.equal(twice.ok, false);
});

test("a lab report needs exactly one result table with rows", () => {
  const maria = scenario("lab-result-maria-beispiel.md").replace(/\r\n/g, "\n");
  const second = parseDocument(`${maria}\n| Test | Result |\n|---|---|\n| CRP | 3 |\n`);
  assert.equal(second.ok, false);
  if (!second.ok) assert.deepEqual(second.errors, ["The lab report has more than one table. Put all results in one table."]);
  if (!second.ok) assert.deepEqual(second.safety, ["several-tables"]);

  const empty = parseDocument(
    "# Labor Kanalstraße: lab report\n\nPatient: Maria Beispiel, born 12 March 1961\nSample taken: yesterday\nReported: 22 October 2026, 11:40\n\n| Test | Result | Unit | Reference range | LOINC code |\n|---|---|---|---|---|\n",
  );
  assert.equal(empty.ok, false);
  // Every reason comes back, not only the first one.
  if (!empty.ok) assert.deepEqual(empty.errors, ['"Sample taken: yesterday" is not a date such as "22 October 2026, 08:10".', "The result table has no rows."]);
});

test("a lab row with a result that is not a number is reported with its row", () => {
  const markdown = scenario("lab-result-maria-beispiel.md").replace("| aPTT | 31 |", "| aPTT | pending |");
  const result = parseDocument(markdown);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.errors, ['Row 2 (aPTT): the result "pending" is not a number.']);
  // A format problem, not a safety refusal: the AI fallback may still read it.
  if (!result.ok) assert.deepEqual(result.safety, []);
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

test("a result with a thousands separator is refused, a decimal comma is read", () => {
  const maria = scenario("lab-result-maria-beispiel.md");
  const grouped = parseDocument(maria.replace("| 245 |", "| 1,245 |"));
  assert.equal(grouped.ok, false);
  if (!grouped.ok) assert.deepEqual(grouped.errors, ['Row 3 (Platelets): the result "1,245" is not a number.']);
  const decimal = parsed(maria.replace("| 3.1 |", "| 3,1 |")) as LabResult;
  assert.equal(decimal.rows[3].value, 3.1);
});

test("a LOINC code with a wrong check digit is refused", () => {
  const result = parseDocument(scenario("lab-result-maria-beispiel.md").replace("6301-6", "6301-5"));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /"6301-5" is not a LOINC code .* check digit/);
  // All scenario codes and the report code 11502-2 from docs/FHIR.md have valid check digits.
  for (const file of ["lab-result-maria-beispiel.md", "lab-result-max-beispiel.md"]) assert.equal((parsed(scenario(file)) as LabResult).rows.length, 4);
  assert.ok(parseDocument(scenario("lab-result-maria-beispiel.md").replace("6301-6", "11502-2")).ok);
});

test("a byte order mark at the start does not hide the heading", () => {
  const doc = parsed(`\uFEFF${scenario("lab-result-maria-beispiel.md")}`) as LabResult;
  assert.equal(doc.organisation, "Labor Kanalstraße");
});

test("an unknown key outside the sections stays in the conclusion", () => {
  const doc = parsed(scenario("lab-result-maria-beispiel.md").replace("All values are within the reference range.", "Note: INR was measured twice.")) as LabResult;
  assert.equal(doc.conclusion, "Note: INR was measured twice.");
  assert.equal(doc.fields["Note"], "INR was measured twice.");
});

test("a key repeated with the same value is fine", () => {
  const maria = scenario("lab-result-maria-beispiel.md").replace(/\r\n/g, "\n");
  const doc = parsed(`${maria}\nPatient: Maria Beispiel, born 12 March 1961\n`);
  assert.deepEqual(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" });
});

test("every paragraph of a list item is list text, not a field", () => {
  const rehab = scenario("rehab-report-maria-beispiel.md").replace(/\r\n/g, "\n");
  const doc = parsed(rehab.replace("- Continue the home exercises.\n", "- Continue the home exercises.\n\n  Reason: keeps the hip mobile\n\n")) as RehabReport;
  assert.match(doc.reason ?? "", /^rehabilitation after a total hip replacement/);
  assert.match(doc.sections[2].text, /- Reason: keeps the hip mobile/);
});

test("Austrian titles, also the female forms, are split off the name", () => {
  assert.deepEqual(parsePersonLine("Prim. Dr.in Eva Brandl, lab physician")?.titles, ["Prim.", "Dr.in"]);
  assert.equal(parsePersonLine("Mag.a DDr. Eva Brandl")?.given, "Eva");
  // A given name that looks like a title without its dot stays a name.
  assert.equal(parsePersonLine("Dia Brandl")?.given, "Dia");
});

test("a leading zero means a decimal comma, and an unknown key may repeat", () => {
  const maria = scenario("lab-result-maria-beispiel.md");
  assert.equal((parsed(maria.replace("| 3.1 |", "| 0,125 |")) as LabResult).rows[3].value, 0.125);
  const notes = parsed(maria.replace("All values are within the reference range.", "Note: first.\n\nNote: second.")) as LabResult;
  assert.equal(notes.conclusion, "Note: first. Note: second.");
});

test("joined titles need a separator, so a name such as Magdi stays a name", () => {
  assert.equal(parsePersonLine("Magdi Hassan, lab physician")?.given, "Magdi");
  assert.deepEqual(parsePersonLine("Univ.-Prof. Dipl.-Ing. Dr.med. Eva Brandl")?.titles, ["Univ.-Prof.", "Dipl.-Ing.", "Dr.med."]);
});
