import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseDateWide, parseStayWide, parseViennaDateTimeWide } from "./dates";
import { HELD_REASON, UNVERIFIED_REASON, appearsVerbatim, parseWithFallback, type DocumentReader, type ModelReading } from "./fallback";
import { parseDocument } from "./parse";
import { checkAnswerPatient } from "./patient-check";
import type { LabResult } from "./types";

// The model is always a stub here: tests never call the network.

const fixture = (file: string) => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8");
const scenario = (file: string) => readFileSync(new URL(`../../../track/scenario/documents/${file}`, import.meta.url), "utf8");
const otherFormat = fixture("lab-result-maria-beispiel-other-format.md");

/** What a model should return for the fixture: every value copied as written. */
const goodReading = (): ModelReading => ({
  type: "lab-result",
  title: "Lab report — Labor Kanalstraße",
  organisation: "Labor Kanalstraße",
  kind: "Lab report",
  patientName: "Maria Beispiel",
  patientBirthDate: "12.03.1961",
  fields: [
    { key: "Patient name", value: "Maria Beispiel" },
    { key: "Date of birth", value: "12.03.1961" },
    { key: "Requested by", value: "Dr. Lena Hofer, Klinikum Beispielstadt" },
    { key: "Sample taken", value: "22.10.2026 08:10" },
    { key: "Reported", value: "22.10.2026 11:40" },
  ],
  sampleTaken: "22.10.2026 08:10",
  reported: "22.10.2026 11:40",
  rows: [
    { test: "INR (prothrombin time)", valueText: "1.0", unitText: "", rangeText: "0.8 - 1.2", loinc: "6301-6" },
    { test: "aPTT", valueText: "31", unitText: "s", rangeText: "25 - 37", loinc: "14979-9" },
    { test: "Platelets", valueText: "245", unitText: "10^9/L", rangeText: "150 - 400", loinc: "777-3" },
    { test: "Fibrinogen", valueText: "3.1", unitText: "g/L", rangeText: "2.0 - 4.0", loinc: "3255-7" },
  ],
  conclusion: "All values are within the reference range.",
  validatedBy: "Dr. Eva Brandl, lab physician",
  stay: "",
  reason: "",
  sections: [],
  writtenBy: "",
  sentBy: "",
});

const stub =
  (output: unknown): DocumentReader =>
  async () => ({ model: "stub-model", output });
const maria = { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" };

test("the parser cannot read the fixture in the other format", () => {
  assert.equal(parseDocument(otherFormat).ok, false);
});

test("the fallback reads the other format into the same LabResult and holds it for Dr. Hofer", async () => {
  const result = await parseWithFallback(otherFormat, stub(goodReading()));
  assert.ok(result.ok && "held" in result, JSON.stringify(result));
  assert.deepEqual(result.held, { by: "model", model: "stub-model", reason: HELD_REASON });

  const doc = result.document as LabResult;
  assert.equal(doc.type, "lab-result");
  assert.equal(doc.organisation, "Labor Kanalstraße");
  assert.equal(doc.kind, "lab report");
  assert.deepEqual(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" });
  assert.equal(doc.sampleTaken, "2026-10-22T08:10:00+02:00");
  assert.equal(doc.reported, "2026-10-22T11:40:00+02:00");
  assert.equal(doc.conclusion, "All values are within the reference range.");
  assert.deepEqual(doc.validatedBy, { raw: "Dr. Eva Brandl, lab physician", titles: ["Dr."], given: "Eva", family: "Brandl", details: ["lab physician"] });
  assert.equal(doc.fields["Requested by"], "Dr. Lena Hofer, Klinikum Beispielstadt");
  assert.equal(doc.markdown, otherFormat);
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
  // The patient check stays deterministic and runs on the model's reading as on the parser's.
  assert.equal(checkAnswerPatient(doc.patient, { name: "Maria Beispiel", birthDate: "1961-03-12" }, maria).pass, true);
});

test("a hallucinated result value is held without a document", async () => {
  const reading = goodReading();
  reading.rows[1].valueText = "35";
  const result = await parseWithFallback(otherFormat, stub(reading));
  assert.ok(!result.ok && "held" in result);
  assert.equal(result.held.reason, UNVERIFIED_REASON);
  assert.deepEqual(result.held.unverified, ['rows[1].valueText: "35"']);
  assert.ok(!("document" in result));
});

test("a LOINC code that is not in the document, or only part of one, is held", async () => {
  const reading = goodReading();
  reading.rows[0].loinc = "301-6"; // inside "6301-6", but not a whole code
  reading.rows[2].loinc = "26515-7"; // a real platelet code, but not in this document
  const result = await parseWithFallback(otherFormat, stub(reading));
  assert.ok(!result.ok && "held" in result);
  assert.deepEqual(result.held.unverified, ['rows[0].loinc: "301-6"', 'rows[2].loinc: "26515-7"']);
});

test("a missing LOINC code is held", async () => {
  const reading = goodReading();
  reading.rows[3].loinc = "";
  const result = await parseWithFallback(otherFormat, stub(reading));
  assert.ok(!result.ok && "held" in result);
  assert.deepEqual(result.held.unverified, ['rows[3].loinc: "" is not a LOINC code']);
});

test("a patient name the document does not contain is held", async () => {
  const reading = goodReading();
  reading.patientName = "Max Beispiel";
  const result = await parseWithFallback(otherFormat, stub(reading));
  assert.ok(!result.ok && "held" in result);
  assert.deepEqual(result.held.unverified, ['patientName: "Max Beispiel"']);
});

test("verified values that cannot become typed fields are held with the reason", async () => {
  const reading = goodReading();
  reading.sampleTaken = "Sample taken"; // in the document, but not a date
  const result = await parseWithFallback(otherFormat, stub(reading));
  assert.ok(!result.ok && "held" in result);
  assert.equal(result.held.reason, HELD_REASON);
  assert.deepEqual(result.held.unverified, []);
  assert.ok(result.errors.includes('The model found no readable "Sample taken" date.'));
});

test("the parser's result stands when it reads the file, when no model is set, or when the model fails", async () => {
  const neverCalled: DocumentReader = async () => assert.fail("the model must not be called");
  const parsed = await parseWithFallback(scenario("lab-result-maria-beispiel.md"), neverCalled);
  assert.ok(parsed.ok && !("held" in parsed));

  const parserOnly = parseDocument(otherFormat);
  assert.deepEqual(await parseWithFallback(otherFormat, null), parserOnly);
  assert.deepEqual(await parseWithFallback(otherFormat, () => Promise.reject(new Error("offline"))), parserOnly);
  assert.deepEqual(await parseWithFallback(otherFormat, stub({ type: "lab-result" })), parserOnly);
});

test("appearsVerbatim matches whole values with the same case, any white space", () => {
  assert.equal(appearsVerbatim("Dr. Eva Brandl, lab physician", otherFormat), true);
  assert.equal(appearsVerbatim("All values are   within\nthe reference range.", otherFormat), true);
  assert.equal(appearsVerbatim("dr. eva brandl", otherFormat), false);
  assert.equal(appearsVerbatim("1.0", "| 11.05 |"), false);
  assert.equal(appearsVerbatim("1.0", "| 1.0 |"), true);
  assert.equal(appearsVerbatim("3255-7", "LOINC 3255-7."), true);
  assert.equal(appearsVerbatim("", "anything"), true);
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
