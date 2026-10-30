import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseDateWide, parseStayWide, parseViennaDateTimeWide } from "./dates";
import * as fallback from "./fallback";
import { HELD_REASON, UNVERIFIED_REASON, modelReadingSchema, parseWithFallback, type DocumentReader, type ModelReading } from "./fallback";
import { parseDocument } from "./parse";
import { checkAnswerPatient } from "./patient-check";
import type { LabResult, RehabReport } from "./types";

// The model is always a stub here: tests never call the network.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const scenario = (file: string) => read(`../../../track/scenario/documents/${file}`);
const lab = read("./fixtures/lab-result-maria-beispiel-other-format.md");
const rehab = read("./fixtures/rehab-report-maria-beispiel-other-format.md");

const empty = { stay: "", reason: "", writtenBy: "", sentBy: "" };
/** A model reading that agrees with the lab fixture. */
const goodLab = (): ModelReading => ({
  type: "lab-result",
  organisation: "Labor Kanalstraße",
  kind: "Lab report",
  patientName: "Maria Beispiel",
  patientBirthDate: "12.03.1961",
  sampleTaken: "22.10.2026 08:10",
  reported: "22.10.2026 11:40",
  validatedBy: "Dr. Eva Brandl, lab physician",
  ...empty,
  rows: [
    { test: "INR (prothrombin time)", valueText: "1.0", unitText: "", rangeText: "0.8 - 1.2", loinc: "6301-6" },
    { test: "aPTT", valueText: "31", unitText: "s", rangeText: "25 - 37", loinc: "14979-9" },
    { test: "Platelets", valueText: "245", unitText: "10^9/L", rangeText: "150 - 400", loinc: "777-3" },
    { test: "Fibrinogen", valueText: "3.1", unitText: "g/L", rangeText: "2.0 - 4.0", loinc: "3255-7" },
  ],
});
/** A model reading that agrees with the rehab fixture. */
const goodRehab = (): ModelReading => ({
  type: "rehab-report",
  organisation: "Reha Waldblick",
  kind: "Discharge report",
  patientName: "Maria Beispiel",
  patientBirthDate: "12.03.1961",
  sampleTaken: "",
  reported: "",
  validatedBy: "",
  stay: "02.09.2026 - 23.09.2026",
  reason: "rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt",
  writtenBy: "Dr. Johanna Leitner, medical director, Reha Waldblick",
  sentBy: "Stefan Kern, discharge management",
  rows: [],
});

const stub =
  (output: unknown): DocumentReader =>
  async () => ({ model: "stub-model", output });
const neverCalled: DocumentReader = async () => assert.fail("the model must not be called");
const maria = { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" };
const changed = (base: () => ModelReading, change: (r: ModelReading) => void) => {
  const reading = base();
  change(reading);
  return reading;
};

/** The model disagrees with the document: held with the file only. Returns the disagreeing values. */
async function disagrees(markdown: string, reading: ModelReading): Promise<string[]> {
  const result = await parseWithFallback(markdown, stub(reading));
  assert.ok(!result.ok && "held" in result, JSON.stringify(result));
  assert.equal(result.held.reason, UNVERIFIED_REASON);
  return result.held.unverified;
}
/** The model agrees: a held record. */
async function record(markdown: string, reading: ModelReading) {
  const result = await parseWithFallback(markdown, stub(reading));
  assert.ok(result.ok && "held" in result, JSON.stringify(result));
  assert.deepEqual(result.held, { by: "model", model: "stub-model", reason: HELD_REASON });
  return result.document;
}
/** A safety refusal: the model is never called. Returns the refusals. */
async function refused(markdown: string) {
  const result = await parseWithFallback(markdown, neverCalled);
  assert.ok(!result.ok && !("held" in result), JSON.stringify(result));
  assert.ok(result.safety.length, result.errors.join("; "));
  return result.safety;
}
/** Code cannot read the file: no record, no hold, and the model is never called. Returns the errors. */
async function unreadable(markdown: string) {
  const result = await parseWithFallback(markdown, neverCalled);
  assert.ok(!result.ok && !("held" in result), JSON.stringify(result));
  assert.deepEqual(result.safety, []);
  return result.errors;
}
const insertAfter = (markdown: string, anchor: string, line: string) => markdown.replace(anchor, `${anchor}\n${line}`);
/** Comments a lab report may carry outside its plain lines, and how each reaches the conclusion. */
const hiddenComments = [
  ["\n## Comment\n\nSample haemolysed, all results invalid.\n", "Comment: Sample haemolysed, all results invalid."],
  ["\n### Comment\n\nSample haemolysed, all results invalid.\n", "Comment Sample haemolysed, all results invalid."],
  ["\n# Addendum\n\nSample haemolysed, all results invalid.\n", "Addendum Sample haemolysed, all results invalid."],
  ["\n```\nSample haemolysed, all results invalid.\n```\n", "Sample haemolysed, all results invalid."],
] as const;

test("the parser cannot read either fixture, and neither is a safety refusal", () => {
  for (const markdown of [lab, rehab]) {
    const result = parseDocument(markdown);
    assert.ok(!result.ok);
    assert.deepEqual(result.safety, []);
  }
});

test("the fallback reads the lab report in the other format into the same LabResult and holds it", async () => {
  const doc = (await record(lab, goodLab())) as LabResult;
  assert.equal(doc.type, "lab-result");
  assert.equal(doc.organisation, "Labor Kanalstraße");
  assert.equal(doc.kind, "lab report");
  assert.deepEqual(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" });
  assert.equal(doc.sampleTaken, "2026-10-22T08:10:00+02:00");
  assert.equal(doc.reported, "2026-10-22T11:40:00+02:00");
  assert.equal(doc.conclusion, "All values are within the reference range.");
  assert.deepEqual(doc.validatedBy, { raw: "Dr. Eva Brandl, lab physician", titles: ["Dr."], given: "Eva", family: "Brandl", details: ["lab physician"] });
  assert.equal(doc.fields["Requested by"], "Dr. Lena Hofer, Klinikum Beispielstadt");
  assert.equal(doc.markdown, lab);
  // The same rows the parser reads from the scenario file.
  assert.deepEqual(
    doc.rows.map((r) => [r.test, r.value, r.ucum, r.low, r.high, r.loinc, r.interpretation]),
    [
      ["INR (prothrombin time)", 1, null, 0.8, 1.2, "6301-6", "N"],
      ["aPTT", 31, "s", 25, 37, "14979-9", "N"],
      ["Platelets", 245, "10*9/L", 150, 400, "777-3", "N"],
      ["Fibrinogen", 3.1, "g/L", 2, 4, "3255-7", "N"],
    ],
  );
  assert.equal(checkAnswerPatient(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" }, maria).pass, true);
});

test("the fallback reads the rehab report in the other format and holds it", async () => {
  const doc = (await record(rehab, goodRehab())) as RehabReport;
  assert.equal(doc.type, "rehab-report");
  assert.equal(doc.organisation, "Reha Waldblick");
  assert.deepEqual(doc.stay, { start: "2026-09-02", end: "2026-09-23" });
  assert.equal(doc.writtenBy?.family, "Leitner");
  assert.equal(doc.sentBy?.family, "Kern");
  assert.deepEqual(
    doc.sections.map((s) => s.heading),
    ["Course", "Recommendations"],
  );
  assert.equal(doc.sections[1].text, "- Continue the home exercises.\n- Outpatient physiotherapy twice a week for six weeks.");
});

// Finding 1: code, not the model, reads the patient.

test("the patient name is the whole value of the patient line, read by code", async () => {
  for (const name of ["Anna Maria Beispiel", "Maria Beispiel Gruber"]) {
    assert.deepEqual(await disagrees(lab.replace("Patient name: Maria Beispiel", `Patient name: ${name}`), goodLab()), ['patientName: "Maria Beispiel"']);
  }
  // Family name first is a real format, and the whole value is the name.
  const surnameFirst = lab.replace("Patient name: Maria Beispiel\nDate of birth: 12.03.1961", "Patient: BEISPIEL Maria, DOB 12.03.1961");
  const doc = await record(surnameFirst, changed(goodLab, (r) => (r.patientName = "BEISPIEL Maria")));
  assert.deepEqual(doc.patient, { name: "BEISPIEL Maria", birthDate: "1961-03-12" });
  assert.equal(checkAnswerPatient(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" }, maria).pass, true);
});

test("a patient line with more than a name and a birth clause gives no record, so no name is cut short", async () => {
  // Cut at the first comma, these would read "Beispiel" or "Maria Beispiel" and pass the patient check for Maria.
  for (const value of ["Beispiel, Max", "Maria Beispiel, Max Beispiel", "Max Beispiel, son of Maria Beispiel"]) {
    const errors = await unreadable(lab.replace("Patient name: Maria Beispiel", `Patient name: ${value}`));
    assert.ok(errors.includes(`The patient line "${value}" has more than a name and a birth date such as ", born 12 March 1961".`), errors.join("; "));
  }
});

test("the birth date is the patient's own, and two different birth dates are refused", async () => {
  const mother = lab.replace("Date of birth: 12.03.1961", "Date of birth: 03.12.1961\nMother's date of birth: 12.03.1961");
  assert.deepEqual(await disagrees(mother, goodLab()), ['patientBirthDate: "12.03.1961"']);
  const doc = await record(mother, changed(goodLab, (r) => (r.patientBirthDate = "03.12.1961")));
  assert.equal(doc.patient.birthDate, "1961-12-03");

  assert.deepEqual(await refused(lab.replace("Date of birth: 12.03.1961", "Date of birth: 03.12.1961\nBirth date: 12.03.1961")), ["several-birth-dates"]);
  assert.deepEqual(await refused(lab.replace("Patient name: Maria Beispiel", "Patient: Maria Beispiel, born 3 December 1961")), ["several-birth-dates"]);
});

// Finding 2: each key field comes from its own keys.

test("a key field from another line is not the field", async () => {
  assert.deepEqual(await disagrees(lab, changed(goodLab, (r) => (r.validatedBy = "Dr. Lena Hofer, Klinikum Beispielstadt"))), [
    'validatedBy: "Dr. Lena Hofer, Klinikum Beispielstadt"',
  ]);
  assert.deepEqual(await disagrees(lab, changed(goodLab, (r) => (r.validatedBy = "Maria Beispiel"))), ['validatedBy: "Maria Beispiel"']);
  assert.deepEqual(await disagrees(lab, changed(goodLab, (r) => ([r.sampleTaken, r.reported] = [r.reported, r.sampleTaken]))), [
    'sampleTaken: "22.10.2026 11:40"',
    'reported: "22.10.2026 08:10"',
  ]);
  assert.deepEqual(await disagrees(rehab, changed(goodRehab, (r) => ([r.writtenBy, r.sentBy] = [r.sentBy, r.writtenBy]))), [
    'writtenBy: "Stefan Kern, discharge management"',
    'sentBy: "Dr. Johanna Leitner, medical director, Reha Waldblick"',
  ]);
});

test("a field under two keys with different values gives no record", async () => {
  const errors = await unreadable(insertAfter(lab, "Sample taken: 22.10.2026 08:10", "Collected: 21.10.2026 07:00"));
  assert.ok(errors.includes("The file has more than one line for sampleTaken."), errors.join("; "));
});

// Finding 3: each lab value comes from the column whose header names it.

test("a value from another column is not the value, and an ambiguous column gives no record", async () => {
  const previous = lab
    .replace("| Analyte | Value | Unit |", "| Analyte | Value | Previous | Unit |")
    .replace("|---|---|---|---|---|", "|---|---|---|---|---|---|")
    .replace("| INR (prothrombin time) | 1.0 |", "| INR (prothrombin time) | 1.0 | 1.1 |")
    .replace("| aPTT | 31 |", "| aPTT | 48 | 31 |")
    .replace("| Platelets | 245 |", "| Platelets | 245 | 250 |")
    .replace("| Fibrinogen | 3.1 |", "| Fibrinogen | 3.1 | 3.0 |");
  const fromPrevious = changed(goodLab, (r) => (r.rows[1].valueText = "31"));
  assert.deepEqual(await disagrees(previous, fromPrevious), ['rows[1].valueText: "31"']);
  const doc = (await record(previous, changed(goodLab, (r) => (r.rows[1].valueText = "48")))) as LabResult;
  assert.deepEqual([doc.rows[1].value, doc.rows[1].interpretation], [48, "H"]);

  const twoResults = lab.replace("| Analyte | Value | Unit |", "| Analyte | Result | Unit |").replace("| Normal range |", "| Value |");
  assert.ok((await unreadable(twoResults)).includes("The result table needs exactly one result column."));
});

// Finding 4: code decides the type.

test("the type comes from the heading, and a table under an unknown kind gives no record", async () => {
  assert.deepEqual(
    await disagrees(
      lab,
      changed(goodLab, (r) => Object.assign(r, { type: "other", rows: [] })),
    ),
    ['type: "other"', "rows: 0 rows, but the table has 4"],
  );
  const errors = await unreadable(lab.replace("# Lab report — Labor Kanalstraße", "# Findings — Labor Kanalstraße"));
  assert.ok(errors.includes("The file has a table, but its heading names no lab report, so its results cannot be read."));
});

// Finding 5: a range that cannot be read gives no record.

test("dash ranges are read, and a range that cannot be read gives no record instead of no flag", async () => {
  const aptt48 = (range: string) => lab.replace("| aPTT | 31 | s | 25 - 37 |", `| aPTT | 48 | s | ${range} |`);
  for (const range of ["25 — 37", "25 − 37", "25 – 37", "25 to 37"]) {
    const doc = (await record(aptt48(range), changed(goodLab, (r) => Object.assign(r.rows[1], { valueText: "48", rangeText: range })))) as LabResult;
    assert.deepEqual([doc.rows[1].low, doc.rows[1].high, doc.rows[1].interpretation], [25, 37, "H"], range);
  }
  for (const range of ["25 bis 37", "< 37"]) {
    const errors = await unreadable(aptt48(range));
    assert.ok(errors.includes(`Row 2 (aPTT): the reference range "${range}" cannot be read.`), errors.join("; "));
  }
});

// Finding 6: a second patient in any form is refused before the model.

test("a second patient in any written form is refused without the model", async () => {
  const lines = [
    "**Patient name:** Max Beispiel",
    "Patient’s name: Max Beispiel",
    "## Patient: Max Beispiel",
    "Patient:Max Beispiel",
    "Name: Max Beispiel",
    "Patient (2): Max Beispiel",
    "\n    Patient: Max Beispiel\n",
    "\n<div>Patient: Max Beispiel</div>\n",
  ];
  for (const line of lines) {
    assert.ok((await refused(insertAfter(lab, "Reported: 22.10.2026 11:40\n", line))).includes("several-patients"), line);
  }
});

test("the parser refuses a bold second patient line too", () => {
  const result = parseDocument(insertAfter(scenario("lab-result-maria-beispiel.md"), "Reported: 22 October 2026, 11:40\n", "**Patient:** Max Beispiel, born 3 July 1958"));
  assert.ok(!result.ok);
  assert.deepEqual(result.safety, ["several-patients", "several-birth-dates"]);
});

// Finding 7: code builds the free text.

test("the conclusion is the free text, built by code: lines, notes, sections, sub-headings, and code blocks", async () => {
  const note = lab
    .replace("All values are within the reference range.", "Not all values are within the reference range.")
    .replace("Validated by:", "Note: sample haemolysed, results invalid.\n\nValidated by:");
  const doc = (await record(note, goodLab())) as LabResult;
  assert.equal(doc.conclusion, "Not all values are within the reference range. Note: sample haemolysed, results invalid.");
  assert.equal("conclusion" in modelReadingSchema.shape, false);

  for (const [extra, text] of hiddenComments) {
    const commented = (await record(`${lab}${extra}`, goodLab())) as LabResult;
    assert.equal(commented.conclusion, `All values are within the reference range. ${text}`, extra);
  }
});

test("the parser puts sections, sub-headings, and code blocks of a lab report into the conclusion too", () => {
  for (const [extra, text] of hiddenComments) {
    const result = parseDocument(`${scenario("lab-result-maria-beispiel.md")}${extra}`);
    assert.ok(result.ok && result.document.type === "lab-result", extra);
    assert.equal(result.document.conclusion, `All values are within the reference range. ${text}`, extra);
  }
});

// Round 3, finding 2: `Name`, `Full name`, and `Born` identify the patient only in the header block.

test("Name and Born below the header block are text, in the parser and in the fallback", async () => {
  const rehabScenario = scenario("rehab-report-maria-beispiel.md");
  for (const markdown of [
    `${rehabScenario}\n## Contact\n\nName: Stefan Kern\n`,
    `${scenario("lab-result-maria-beispiel.md")}\nName: Labor Kanalstraße GmbH\n`,
    `${rehabScenario}\n## History\n\nBorn: in Linz, grew up on a farm.\n`,
  ]) {
    const result = parseDocument(markdown);
    assert.ok(result.ok, result.ok ? "" : result.errors.join("; "));
  }
  for (const extra of ["\n## Contact\n\nName: Stefan Kern\n", "\n## History\n\nBorn: in Linz, grew up on a farm.\n", "\nFull name: Reha Waldblick GmbH\n"]) {
    const doc = (await record(`${rehab}${extra}`, goodRehab())) as RehabReport;
    assert.deepEqual(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" }, extra);
  }
  // In the header block they still name the patient.
  assert.ok((await refused(insertAfter(lab, "Date of birth: 12.03.1961", "Name: Max Beispiel"))).includes("several-patients"));
  assert.ok((await refused(insertAfter(lab, "Date of birth: 12.03.1961", "Born: 03.12.1961"))).includes("several-birth-dates"));
});

// Round 3, finding 3: only keys code reads can be a repeated key.

test("two Note lines are text, not a safety refusal", async () => {
  const notes = lab.replace("Validated by:", "Note: haemolysed sample.\nNote: repeat aPTT.\n\nValidated by:");
  const doc = (await record(notes, goodLab())) as LabResult;
  assert.equal(doc.conclusion, "All values are within the reference range. Note: haemolysed sample. Note: repeat aPTT.");
});

// Round 3, finding 5: more written forms of a second patient.

test("a second patient with a dash, a fullwidth colon, a link, or first name and surname lines is refused", async () => {
  for (const line of ["Patient - Max Beispiel", "Patient： Max Beispiel", "[Patient: Max Beispiel](#)", "First name: Max\nSurname: Beispiel"]) {
    assert.ok((await refused(insertAfter(lab, "Reported: 22.10.2026 11:40\n", line))).includes("several-patients"), line);
  }
  // First name and surname lines that agree with the patient line are fine, and alone they name the patient.
  assert.ok(await record(insertAfter(lab, "Date of birth: 12.03.1961", "First name: Maria\nSurname: Beispiel"), goodLab()));
  const split = lab.replace("Patient name: Maria Beispiel", "First name: Maria\nSurname: Beispiel");
  assert.deepEqual((await record(split, goodLab())).patient, { name: "Maria Beispiel", birthDate: "1961-03-12" });
});

// Earlier rounds, still held or refused.

test("a hallucinated value, a dropped row, or a foreign LOINC code is held without a record", async () => {
  assert.deepEqual(await disagrees(lab, changed(goodLab, (r) => (r.rows[1].valueText = "35"))), ['rows[1].valueText: "35"']);
  assert.deepEqual(await disagrees(lab, changed(goodLab, (r) => r.rows.splice(1, 1))), ["rows: 3 rows, but the table has 4"]);
  assert.deepEqual(await disagrees(lab, changed(goodLab, (r) => (r.rows[0].loinc = "301-6"))), ['rows[0].loinc: "301-6"']);
  assert.deepEqual(await disagrees(lab, changed(goodLab, (r) => (r.rows[1].unitText = ""))), ['rows[1].unitText: ""']);
});

test("a LOINC code with a wrong check digit in the document gives no record", async () => {
  const errors = await unreadable(lab.replace("| 6301-6 |", "| 6301-5 |"));
  assert.ok(errors.some((e) => e.includes('"6301-5" is not a LOINC code')));
});

test("a parser safety refusal never reaches the model: a second Patient line or a second table", async () => {
  const scenarioLab = scenario("lab-result-maria-beispiel.md");
  assert.ok((await refused(scenarioLab.replace("\nSample taken:", "\nPatient: Max Beispiel, born 3 July 1958\nSample taken:"))).includes("repeated-key"));
  assert.deepEqual(await refused(`${scenarioLab}\n| Test | Result |\n|---|---|\n| aPTT | 44 |\n`), ["several-tables"]);
});

test("the same refusals in a format the parser does not know never reach the model either", async () => {
  assert.deepEqual(await refused(`${lab}\n| Analyte | Value |\n|---|---|\n| aPTT | 44 |\n`), ["several-tables"]);
  assert.deepEqual(await refused(insertAfter(lab, "Sample taken: 22.10.2026 08:10", "Sample taken: 21.10.2026 07:00")), ["repeated-key"]);
});

test("the parser's result stands when it reads the file, when no model is set, or when the model fails", async () => {
  const parsed = await parseWithFallback(scenario("lab-result-maria-beispiel.md"), neverCalled);
  assert.ok(parsed.ok && !("held" in parsed));

  const parserOnly = parseDocument(lab);
  assert.deepEqual(await parseWithFallback(lab, null), parserOnly);
  assert.deepEqual(await parseWithFallback(lab, () => Promise.reject(new Error("offline"))), parserOnly);
  assert.deepEqual(await parseWithFallback(lab, stub({ type: "lab-result" })), parserOnly);
});

test("only parseWithFallback() turns a reading into a record, so every record from the fallback is held", () => {
  assert.deepEqual(Object.keys(fallback).sort(), ["HELD_REASON", "UNVERIFIED_REASON", "modelReadingSchema", "parseWithFallback"]);
});

test("the wide date readers take the dotted and ISO formats", () => {
  assert.equal(parseDateWide("12.03.1961"), "1961-03-12");
  assert.equal(parseDateWide("1961-03-12"), "1961-03-12");
  assert.equal(parseDateWide("12 March 1961"), "1961-03-12");
  assert.equal(parseDateWide("31.02.1961"), null);
  assert.equal(parseDateWide("12.13.1961"), null);
  assert.equal(parseViennaDateTimeWide("22.10.2026 08:10"), "2026-10-22T08:10:00+02:00");
  assert.equal(parseViennaDateTimeWide("22.12.2026, 08:10"), "2026-12-22T08:10:00+01:00");
  assert.equal(parseViennaDateTimeWide("22 October 2026, 08:10"), "2026-10-22T08:10:00+02:00");
  assert.deepEqual(parseStayWide("02.09.2026 - 23.09.2026"), { start: "2026-09-02", end: "2026-09-23" });
  assert.deepEqual(parseStayWide("2 to 23 September 2026"), { start: "2026-09-02", end: "2026-09-23" });
  assert.equal(parseStayWide("23.09.2026 - 02.09.2026"), null);
});
