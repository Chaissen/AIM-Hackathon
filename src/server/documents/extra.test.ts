import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { parseDate } from "./dates";
import { parseDocument } from "./parse";
import { checkAnswerPatient } from "./patient-check";
import type { LabResult, ParsedDocument, RehabReport } from "./types";

// The extra test set from T16 (track/scenario/extra/index.md). The index is the expectation; this test holds the
// documents to it, for the parser and the patient check. Expectations the parser does not meet yet are `todo`, listed
// under "Open parser gaps" in the index.

const extraDir = new URL("../../../track/scenario/extra/", import.meta.url);
const extra = (file: string) => readFileSync(new URL(file, extraDir), "utf8");
const maria = { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" };

type IndexRow = { file: string; kind: string; patient: string; sender: string; expected: string };

/** The rows of the table under "## Documents" in index.md. */
function indexRows(): IndexRow[] {
  const section = extra("index.md").replace(/\r\n?/g, "\n").split("\n## ")[1];
  assert.ok(section?.startsWith("Documents"), 'index.md has no "## Documents" section');
  return section
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const [file, kind, patient, sender, expected] = line.slice(1, -1).split(" | ").map((c) => c.trim());
      return { file: file.replace(/`/g, ""), kind, patient, sender, expected };
    });
}

function parsed(file: string): ParsedDocument {
  const result = parseDocument(extra(file));
  assert.ok(result.ok, `${file}: ${result.ok ? "" : result.errors.join("; ")}`);
  return result.document;
}

const TYPE_OF_KIND: Record<string, ParsedDocument["type"]> = { "Lab result": "lab-result", "Rehab report": "rehab-report", Other: "other" };

test("index.md lists every extra document exactly once", () => {
  const listed = indexRows().map((r) => r.file).sort();
  const files = readdirSync(extraDir).filter((f) => f.endsWith(".md") && f !== "index.md").sort();
  assert.deepEqual(listed, files);
  assert.ok(files.length >= 8, "T16 asks for at least 8 documents");
});

for (const entry of indexRows()) {
  test(`${entry.file}: kind, patient, and outcome as in index.md`, () => {
    const doc = parsed(entry.file);
    assert.equal(doc.type, TYPE_OF_KIND[entry.kind], `kind "${entry.kind}"`);

    const [name, born] = entry.patient.split(", born ");
    assert.deepEqual(doc.patient, { name, birthDate: parseDate(born) });

    // The sender copies the name and birth date from the document into the form, as the scenario README says.
    // Only the patient check is asserted. The release check (T15) and the identity checks are not tested here yet.
    const check = checkAnswerPatient(doc.patient, doc.patient, maria);
    const outcome = entry.expected.match(/^\w+/)?.[0];
    if (outcome === "Filed" || outcome === "Held") assert.equal(check.pass, true, "the patient check must pass");
    else if (outcome === "Blocked") assert.deepEqual(check, { pass: false, document: false, form: false });
    else assert.fail(`unknown outcome "${entry.expected}"`);
    // A generic document is always held for Dr. Hofer (docs/ARCHITECTURE.md, "Document parsing"), never filed directly.
    if (outcome === "Filed") assert.notEqual(doc.type, "other", "a generic document is held, not filed");
  });
}

const lab = (file: string) => parsed(file) as LabResult;
const rehab = (file: string) => parsed(file) as RehabReport;
const row = (doc: LabResult, name: string) => {
  const found = doc.rows.find((r) => r.test === name);
  assert.ok(found, `no row ${name}`);
  return found;
};

test("blood count: winter offset, 10^12/L, and four values outside the range", () => {
  const doc = lab("lab-result-maria-beispiel-blood-count.md");
  assert.equal(doc.sampleTaken, "2026-10-26T07:50:00+01:00");
  assert.equal(doc.reported, "2026-10-26T10:15:00+01:00");
  assert.equal(row(doc, "Erythrocytes").ucum, "10*12/L");
  assert.deepEqual(
    doc.rows.filter((r) => r.test !== "C-reactive protein").map((r) => [r.test, r.interpretation]),
    [
      ["Haemoglobin", "L"],
      ["Leukocytes", "N"],
      ["Erythrocytes", "L"],
      ["Haematocrit", "L"],
      ["Platelets", "H"],
    ],
  );
  assert.equal(row(doc, "Haematocrit").ucum, "%");
});

test("blood count: CRP 14 with the range < 5 is H", { todo: "parser gap: one-sided reference ranges" }, () => {
  const crp = row(lab("lab-result-maria-beispiel-blood-count.md"), "C-reactive protein");
  assert.deepEqual([crp.low, crp.high, crp.rangeText, crp.interpretation], [null, 5, "< 5", "H"]);
});

test("kidney: decimal commas, and the clock change between sample and report", () => {
  const doc = lab("lab-result-maria-beispiel-kidney.md");
  assert.equal(doc.sampleTaken, "2026-10-24T09:10:00+02:00");
  assert.equal(doc.reported, "2026-10-26T08:05:00+01:00");
  assert.deepEqual(
    doc.rows.map((r) => [r.test, r.value, r.valueText, r.low, r.high, r.interpretation]),
    [
      ["Creatinine", 1.02, "1,02", 0.5, 0.9, "H"],
      ["Sodium", 138, "138", 135, 145, "N"],
      ["Potassium", 3.4, "3,4", 3.5, 5.1, "L"],
      ["Uric acid", 312, "312", 143, 339, "N"],
    ],
  );
});

test("kidney: µmol/L becomes the UCUM code umol/L", () => {
  const urate = row(lab("lab-result-maria-beispiel-kidney.md"), "Uric acid");
  assert.deepEqual([urate.ucum, urate.unitText], ["umol/L", "µmol/L"]);
});

test("metabolic: family name first in capitals, and the ranges that have two ends", () => {
  const doc = lab("lab-result-maria-beispiel-metabolic.md");
  assert.equal(doc.patient.name, "BEISPIEL Maria");
  assert.deepEqual(
    ["HbA1c", "Glucose, fasting", "TSH"].map((t) => [t, row(doc, t).interpretation]),
    [
      ["HbA1c", "H"],
      ["Glucose, fasting", "H"],
      ["TSH", "N"],
    ],
  );
  assert.equal(row(doc, "HbA1c").ucum, "%");
});

test("metabolic: LDL < 116 and HDL > 45 keep one end each", { todo: "parser gap: one-sided reference ranges" }, () => {
  const doc = lab("lab-result-maria-beispiel-metabolic.md");
  const ldl = row(doc, "LDL cholesterol");
  const hdl = row(doc, "HDL cholesterol");
  assert.deepEqual([ldl.low, ldl.high, ldl.interpretation], [null, 116, "H"]);
  assert.deepEqual([hdl.low, hdl.high, hdl.interpretation], [45, null, "N"]);
});

test("metabolic: mIU/L becomes the UCUM code m[IU]/L", () => {
  assert.equal(row(lab("lab-result-maria-beispiel-metabolic.md"), "TSH").ucum, "m[IU]/L");
});

test("rehab 2025: a stay across two months and a clock change stays two dates", () => {
  const doc = rehab("rehab-report-maria-beispiel-2025.md");
  assert.deepEqual(doc.stay, { start: "2025-10-13", end: "2025-11-07" });
  assert.equal(doc.writtenBy?.family, "Leitner");
  assert.equal(doc.sentBy?.raw, "Stefan Kern, discharge management");
});

test("rehab 2024: a stay across a year, a colon inside a section, and a sender with double names", () => {
  const doc = rehab("rehab-report-maria-beispiel-2024.md");
  assert.deepEqual(doc.stay, { start: "2023-12-28", end: "2024-01-25" });
  assert.equal(doc.fields["Pain at discharge"], undefined);
  assert.match(doc.sections[0].text, /\nPain at discharge: 2 of 10, only after long walks\.$/);
  assert.deepEqual(doc.sentBy, {
    raw: "Karl Heinz Moser-Wallner, discharge management",
    titles: [],
    given: "Karl Heinz",
    family: "Moser-Wallner",
    details: ["discharge management"],
  });
});

test("rehab 2024: Prim. counts as a title", () => {
  const { writtenBy } = rehab("rehab-report-maria-beispiel-2024.md");
  assert.deepEqual([writtenBy?.titles, writtenBy?.given, writtenBy?.family], [["Prim.", "Dr."], "Johanna", "Leitner"]);
});

test("Maria Anna Beispiel: µg/dL becomes the UCUM code ug/dL", () => {
  assert.equal(row(lab("lab-result-maria-anna-beispiel.md"), "Iron").ucum, "ug/dL");
});

test("the documents for other patients fail even when the form is filled in with Maria's data", () => {
  const form = { name: "Maria Beispiel", birthDate: "1961-03-12" };
  for (const r of indexRows().filter((r) => r.expected.startsWith("Blocked"))) {
    assert.deepEqual(checkAnswerPatient(parsed(r.file).patient, form, maria), { pass: false, document: false, form: true }, r.file);
  }
});
