import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseDate, parseStay, parseViennaDateTime, viennaInstant } from "./dates";
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
  if (!result.ok)
    assert.deepEqual(result.errors, [
      'The file has more than one "Patient:" line.',
      "The file names more than one patient.",
      "The file gives more than one birth date for the patient.",
    ]);
  if (!result.ok) assert.deepEqual(result.safety, ["repeated-key", "several-patients", "several-birth-dates"]);

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

test("a unit the UCUM list does not know stays text only", () => {
  const markdown = scenario("lab-result-maria-beispiel.md").replace("| 10^9/L |", "| G/L |");
  const doc = parsed(markdown) as LabResult;
  assert.equal(doc.rows[2].unitText, "G/L");
  assert.equal(doc.rows[2].ucum, null);
});

test("a vital sign needs a unit its FHIR profile allows, and blood pressure cannot be a row", () => {
  const maria = scenario("lab-result-maria-beispiel.md");
  const sO2 = (unit: string) => maria.replace("| aPTT | 31 | s | 25 to 37 | 14979-9 |", `| sO2 | 97 | ${unit} | 94 to 98 | 2708-6 |`);
  assert.equal((parsed(sO2("%")) as LabResult).rows[1].ucum, "%");
  const ratio = parseDocument(sO2("ratio"));
  assert.equal(ratio.ok, false);
  if (!ratio.ok) assert.deepEqual(ratio.errors, ['Row 2 (sO2): "ratio" is not a unit for this vital sign. Use a unit such as %.']);

  const none = parseDocument(sO2(""));
  assert.equal(none.ok, false);
  if (!none.ok) assert.deepEqual(none.errors, ["Row 2 (sO2): this vital sign has no unit. Use a unit such as %."]);

  const pressure = parseDocument(maria.replace("| aPTT | 31 | s | 25 to 37 | 14979-9 |", "| Systolic | 120 | mmHg | 90 to 140 | 8480-6 |"));
  assert.equal(pressure.ok, false);
  if (!pressure.ok) assert.match(pressure.errors.join(" "), /^Row 2 \(Systolic\): blood pressure needs systolic and diastolic together/);

  // The oxygen profile's code means arterial blood, so a venous or capillary saturation is refused rather than mislabelled.
  for (const [name, loinc] of [["SvO2", "19224-5"], ["sO2 cap", "2709-4"]]) {
    const result = parseDocument(maria.replace("| aPTT | 31 | s | 25 to 37 | 14979-9 |", `| ${name} | 70 | % | 65 to 75 | ${loinc} |`));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.join(" "), new RegExp(`^Row 2 \\(${name}\\): the FHIR profile for oxygen saturation adds the code for arterial blood`));
  }

  const temperature = (parsed(maria.replace("| aPTT | 31 | s | 25 to 37 | 14979-9 |", "| Temperature | 37.2 | °C | 36 to 37.5 | 8310-5 |")) as LabResult).rows[1];
  assert.equal(temperature.unitText, "°C");
  assert.equal(temperature.ucum, "Cel");
});

test("a row without a test name is called so in its reason", () => {
  const markdown = scenario("lab-result-maria-beispiel.md").replace("| aPTT | 31 | s | 25 to 37 | 14979-9 |", "|  | 31 | s | 25 to 37 | 14997-9 |");
  const result = parseDocument(markdown);
  assert.equal(result.ok, false);
  // 14997-9 swaps two digits of 14979-9, which the check digit catches.
  if (!result.ok) assert.deepEqual(result.errors, ['Row 2 (no test name): "14997-9" is not a LOINC code such as 6301-6, or its check digit is wrong.']);
});

test("dates in Europe/Vienna get the right offset in summer and in winter", () => {
  assert.equal(parseViennaDateTime("22 October 2026, 08:10"), "2026-10-22T08:10:00+02:00");
  // Summer time ends on 25 October 2026 (docs/FHIR.md, validator traps).
  assert.equal(parseViennaDateTime("26 October 2026, 08:10"), "2026-10-26T08:10:00+01:00");
  assert.equal(parseViennaDateTime("29 March 2026, 03:30"), "2026-03-29T03:30:00+02:00");
  assert.equal(parseViennaDateTime("1 January 2027, 0:05"), "2027-01-01T00:05:00+01:00");
  assert.equal(parseViennaDateTime("22 October 2026"), null);
  assert.equal(parseViennaDateTime("22 October 2026, 25:00"), null);
  assert.equal(viennaInstant(new Date("2026-10-29T13:02:12.345Z")), "2026-10-29T14:02:12+01:00");
  assert.equal(viennaInstant(new Date("2026-10-25T00:59:59Z")), "2026-10-25T02:59:59+02:00");
  assert.equal(viennaInstant(new Date("2026-10-25T01:00:00Z")), "2026-10-25T02:00:00+01:00");
  assert.equal(parseDate("1 January 1960"), "1960-01-01");
  assert.equal(parseDate("1 January 0999"), "0999-01-01");
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
  // A leading zero keeps the check digit, but LOINC codes have none: 02160-0 is not 2160-0.
  for (const code of ["02160-0", "00000-0"]) assert.equal(parseDocument(scenario("lab-result-maria-beispiel.md").replace("6301-6", code)).ok, false, code);
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

// #46: a key/value table row and a key with its value on the next line are patient lines too, in every document kind.

const rehabLf = () => scenario("rehab-report-maria-beispiel.md").replace(/\r\n/g, "\n");
const labLf = () => scenario("lab-result-maria-beispiel.md").replace(/\r\n/g, "\n");
const referral = "# Praxis Dr. Huber: referral letter\n\nPatient: Maria Beispiel, born 12 March 1961\n\nPlease see the attached findings.\n";
const kvTable = (...rows: string[]) => `\n## Details\n\n${rows[0]}\n|---|---|\n${rows.slice(1).join("\n")}\n`;

test("a key/value table row names the patient in a rehab report and a generic document", () => {
  for (const base of [rehabLf(), referral]) {
    const cases: [string, string[]][] = [
      [kvTable("| Patient | Max Beispiel |"), ["several-patients"]],
      [kvTable("| Ward | 3 |", "| **Patient name:** | Max Beispiel |"), ["several-patients"]],
      [kvTable("| Patient | Max Beispiel, born 1 January 1960 |"), ["several-patients", "several-birth-dates"]],
      [kvTable("| Ward | 3 |", "| Date of birth | 01.01.1960 |"), ["several-birth-dates"]],
    ];
    for (const [extra, safety] of cases) {
      const result = parseDocument(`${base}${extra}`);
      assert.ok(!result.ok, extra);
      assert.deepEqual(result.safety, safety, extra);
    }
    // The same patient in the table is fine, and so are the tables the scan does not read as key/value.
    for (const extra of [
      kvTable("| Patient | Maria Beispiel |", "| Date of birth | 12.03.1961 |"),
      kvTable("| Patient name | BEISPIEL Maria, DOB 12.03.1961 |"),
      "\n## Contact\n\n| Name | Stefan Kern |\n|---|---|\n| Phone | +43 660 000 0101 |\n",
      "\n## Findings\n\n| Test | Result | Unit |\n|---|---|---|\n| Patient | Max Beispiel | x |\n",
      "\n## Findings\n\n| Test | Result |\n|---|---|\n| CRP | 3 |\n",
    ]) {
      const result = parseDocument(`${base}${extra}`);
      assert.ok(result.ok, `${extra}: ${result.ok ? "" : result.errors.join("; ")}`);
      assert.equal(result.document.patient.name, "Maria Beispiel");
    }
  }
  // A lab report with a key/value table has a second table, which is refused already.
  assert.deepEqual((parseDocument(`${labLf()}${kvTable("| Patient | Maria Beispiel |")}`) as { safety: string[] }).safety, ["several-tables"]);
});

test("a key with its value on the next line names the patient, in the same paragraph or the next one", () => {
  for (const base of [labLf(), rehabLf(), referral]) {
    const cases: [string, string[]][] = [
      ["\nPatient:\nMax Beispiel\n", ["several-patients"]],
      ["\n**Patient name:**\n\nMax Beispiel, born 1 January 1960\n", ["several-patients", "several-birth-dates"]],
      ["\n## Notes\n\nDate of birth:\n01.01.1960\n", ["several-birth-dates"]],
    ];
    for (const [extra, safety] of cases) {
      const result = parseDocument(`${base}${extra}`);
      assert.ok(!result.ok, extra);
      assert.deepEqual(result.safety, safety, extra);
    }
    for (const extra of [
      "\nPatient:\nMaria Beispiel\n",
      "\n**Patient name:**\n\nMaria Beispiel, born 12 March 1961\n",
      "\n## Notes\n\nDate of birth:\n12.03.1961\n",
      // A key line or a heading is never the value of the key above it.
      "\nPatient:\nWard: 3\n",
      "\nPatient:\n\n## Course notes\n\nMax Beispiel walked with two crutches.\n",
    ]) {
      const result = parseDocument(`${base}${extra}`);
      assert.ok(result.ok, `${extra}: ${result.ok ? "" : result.errors.join("; ")}`);
    }
  }
});

test("image alt text alone on its line names the patient like link text, in every document kind", () => {
  for (const base of [labLf(), rehabLf(), referral]) {
    const result = parseDocument(`${base}\n![Patient: Max Beispiel](x.png)\n`);
    assert.ok(!result.ok);
    assert.deepEqual(result.safety, ["several-patients"]);
  }
});

/** Each extra text against Maria's file: the refusals it must give, or none when it must be accepted. */
function expectSafety(cases: [string, string[]][], bases = [labLf(), rehabLf(), referral]) {
  for (const base of bases) {
    for (const [extra, safety] of cases) {
      const result = parseDocument(`${base}${extra}`);
      if (safety.length) assert.deepEqual(result.ok ? [] : result.safety, safety, extra);
      else assert.ok(result.ok, `${extra}: ${result.ok ? "" : result.errors.join("; ")}`);
    }
  }
}

// #46 review: only a value that reads as one is taken from the next line or a table's header row.

test("a sentence after a bare Patient key is not a patient line", () => {
  expectSafety([
    ["\n**Patient:**\n\n72-year-old woman after a total hip replacement on the left.\n", []],
    ["\n**Patient:**\n72-year-old woman after a total hip replacement on the left.\n", []],
    ["\nPatient:\nThe patient was admitted on 3 May.\n", []],
    ["\nPatient:\nAdmitted for rehabilitation\n", []],
    ["\nDate of birth:\nunknown, see the referral.\n", []],
  ]);
});

test("a two-column table with column names in its header is read by column", () => {
  const table = (head: string, row: string) => `\n## Details\n\n${head}\n|---|---|\n${row}\n`;
  expectSafety([
    [table("| Patient | Ward |", "| Maria Beispiel | 3 |"), []],
    [table("| Patient | Date of birth |", "| Maria Beispiel | 12.03.1961 |"), []],
    [table("| Date of birth | Age |", "| 12 March 1961 | 65 |"), []],
    [table("| Patient | Ward |", "| Max Beispiel | 3 |"), ["several-patients"]],
    [table("| Ward | Patient |", "| 3 | Max Beispiel |"), ["several-patients"]],
    [table("| Patient | Date of birth |", "| Max Beispiel | 01.01.1960 |"), ["several-patients", "several-birth-dates"]],
    [table("| Date of birth | Age |", "| 1 January 1960 | 66 |"), ["several-birth-dates"]],
    // `Name` stays a header-only key in a column table too.
    [table("| Name | Phone |", "| Stefan Kern | +43 660 000 0101 |"), []],
    // A lab report with a second table is refused as `several-tables` already.
  ], [rehabLf(), referral]);
});

test("a next-line value with a birth clause after DOB is read as the patient line, as on one line", () => {
  expectSafety([
    ["\nPatient:\nMax Beispiel DOB: 01.01.1960\n", ["several-patients", "several-birth-dates"]],
    ["\nPatient:\nMaria Beispiel DOB: 12.03.1961\n", []],
    ["\nPatient:\nMax Beispiel born: 1 January 1960\n", ["several-patients", "several-birth-dates"]],
  ]);
});

test("a backslash hard break, an HTML block, or a dash also put the value on the next line", () => {
  expectSafety([
    ["\nPatient:\\\nMaria Beispiel\n", []],
    ["\nPatient:\\\nMax Beispiel\n", ["several-patients"]],
    ["\nPatient:\n<div>Maria Beispiel</div>\n", []],
    ["\nPatient:\n<div>Max Beispiel</div>\n", ["several-patients"]],
    ["\nPatient:\n\n<div>\nMax Beispiel\n</div>\n", ["several-patients"]],
    ["\nPatient -\nMaria Beispiel\n", []],
    ["\nPatient -\nMax Beispiel\n", ["several-patients"]],
  ]);
});

// #46 review, round 2.

test("a failed value in a table's first row never makes the table columns", () => {
  const table = (...rows: string[]) => `\n## Details\n\n${rows[0]}\n|---|---|\n${rows.slice(1).join("\n")}\n`;
  expectSafety(
    [
      [table("| Patient | maria beispiel |", "| Date of birth | 12.03.1961 |", "| Ward | 3 |"), []],
      [table("| Patient | Maria Beispiel (f) |"), []],
      [table("| Date of birth | 12.03.1961 (64 y) |", "| Patient | Maria Beispiel |", "| Ward | 3 |"), []],
      [table("| Patient | Max Beispiel (m) |", "| Ward | 3 |"), ["several-patients"]],
      [table("| Date of birth | 01.01.1960 (65 y) |", "| Ward | 3 |"), ["several-birth-dates"]],
    ],
    [rehabLf(), referral],
  );
});

test("a next-line value is read as on one line, unless it is a sentence", () => {
  const next = (key: string, value: string) => `\n${key}:\n${value}\n`;
  const max = [
    "Beispiel, Max",
    "Max Beispiel, 01.01.1960",
    "Max Beispiel (01.01.1960)",
    "Max Beispiel (*01.01.1960)",
    "Max Beispiel - 01.01.1960",
    "Max Beispiel; DOB 01.01.1960",
    "Max Beispiel, b. 01.01.1960",
    "Max Beispiel, male, 65",
    "Max Beispiel Jr.",
    "max beispiel",
    "Max Josef Karl Peter Paul Beispiel",
  ];
  expectSafety([
    ...max.map((v): [string, string[]] => [next("Patient", v), v.includes(";") ? ["several-patients", "several-birth-dates"] : ["several-patients"]]),
    [next("Date of birth", "01.01.1960 (65 years)"), ["several-birth-dates"]],
    [next("Date of birth", "12th March 1961"), ["several-birth-dates"]],
    [next("Patient", "maria beispiel"), []],
    [next("Date of birth", "12.03.1961 (64 y)"), []],
    [next("Patient", "Mobile, walks with crutches."), []],
  ]);
});
