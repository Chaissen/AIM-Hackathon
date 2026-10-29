import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseDocument } from "./parse";
import { checkPatient, patientRecord, samePatient } from "./patient-check";

const read = (path: string) => readFileSync(new URL(`../../../track/scenario/${path}`, import.meta.url), "utf8");
const maria = patientRecord(JSON.parse(read("patient.json")) as fhir4.Patient);

function documentPatient(name: string) {
  const result = parseDocument(read(`documents/${name}`));
  assert.ok(result.ok);
  return result.document.patient;
}

test("reads the patient record from the FHIR Patient", () => {
  assert.deepEqual(maria, { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" });
});

test("both of Maria Beispiel's documents pass", () => {
  for (const name of ["lab-result-maria-beispiel.md", "rehab-report-maria-beispiel.md"]) {
    const { name: docName, birthDate } = documentPatient(name);
    assert.equal(samePatient(docName, birthDate, maria), true, name);
  }
});

test("M3: Max Beispiel's lab result fails", () => {
  const { name, birthDate } = documentPatient("lab-result-max-beispiel.md");
  assert.equal(samePatient(name, birthDate, maria), false);
  assert.equal(samePatient(name, maria.birthDate, maria), false, "the given name alone must fail");
  assert.equal(samePatient("Maria Beispiel", birthDate, maria), false, "the birth date alone must fail");
});

test("tolerates word order, titles, and spelled-out umlauts, nothing more", () => {
  const mueller = { family: "Müller", given: ["Anna", "Maria"], birthDate: "1950-05-01" };
  const cases: [string, boolean][] = [
    ["Anna Müller", true],
    ["Mueller, Anna Maria", true],
    ["Mag. Anna Maria Müller", true],
    ["Müller", true],
    ["Anna", false],
    ["Anna Müller-Huber", false],
    ["Petra Müller", false],
    ["", false],
  ];
  for (const [name, expected] of cases) assert.equal(samePatient(name, "1950-05-01", mueller), expected, name);
});

test("a patient record without a family name or birth date never passes", () => {
  assert.equal(samePatient("Maria", "1961-03-12", { family: "", given: ["Maria"], birthDate: "1961-03-12" }), false);
  assert.equal(samePatient("Maria Beispiel", "", { ...maria, birthDate: "" }), false);
});

test("checkPatient needs both the document and the form, and returns the upload hash", () => {
  const upload = read("documents/lab-result-max-beispiel.md");
  const sha = createHash("sha256").update(upload).digest("hex");
  const form = { name: "Maria Beispiel", birthDate: "1961-03-12" };

  assert.deepEqual(checkPatient({ document: documentPatient("lab-result-max-beispiel.md"), form, patient: maria, upload }), {
    outcome: "fail",
    reason: "patient_mismatch",
    failed: ["document"],
    uploadSha256: sha,
  });
  const wrongForm = checkPatient({ document: form, form: { name: "Max Beispiel", birthDate: "1960-01-01" }, patient: maria, upload });
  assert.equal(wrongForm.outcome, "fail");
  assert.deepEqual(wrongForm.outcome === "fail" && wrongForm.failed, ["form"]);
  assert.deepEqual(checkPatient({ document: form, form, patient: maria, upload: new TextEncoder().encode(upload) }), {
    outcome: "pass",
    uploadSha256: sha,
  });
});
