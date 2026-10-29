import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseDocument } from "./parse";
import { checkAnswerPatient, samePatient, uploadHash } from "./patient-check";

const maria = { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" };
const scenario = (file: string) => readFileSync(new URL(`../../../track/scenario/documents/${file}`, import.meta.url), "utf8");

function patientOf(file: string) {
  const result = parseDocument(scenario(file));
  assert.ok(result.ok);
  return result.document.patient;
}

test("M3: Max Beispiel's lab result fails the patient check for Maria", () => {
  const max = patientOf("lab-result-max-beispiel.md");
  assert.equal(samePatient(max.name, max.birthDate, maria), false);
  // Even if the form is filled in with Maria's data, the document itself is about someone else.
  assert.deepEqual(checkAnswerPatient(max, { name: "Maria Beispiel", birthDate: "1961-03-12" }, maria), {
    pass: false,
    document: false,
    form: true,
  });
});

test("Maria's documents pass the patient check", () => {
  for (const file of ["lab-result-maria-beispiel.md", "rehab-report-maria-beispiel.md"]) {
    const doc = patientOf(file);
    assert.equal(checkAnswerPatient(doc, { name: "Maria Beispiel", birthDate: "1961-03-12" }, maria).pass, true, file);
  }
});

test("the form must match too", () => {
  const doc = patientOf("lab-result-maria-beispiel.md");
  assert.deepEqual(checkAnswerPatient(doc, { name: "Maria Beispiel", birthDate: "1961-12-03" }, maria), { pass: false, document: true, form: false });
});

test("samePatient follows the rules in docs/IDENTITY.md", () => {
  const cases: [string, string, boolean][] = [
    ["Maria Beispiel", "1961-03-12", true],
    ["maria beispiel", "1961-03-12", true], // case does not matter
    ["Beispiel", "1961-03-12", true], // the family name alone is enough, the birth date carries the rest
    ["Beispiel, Maria", "1961-03-12", true],
    ["Max Beispiel", "1960-01-01", false], // M3
    ["Max Beispiel", "1961-03-12", false], // a foreign given name
    ["Maria Beispiel", "1960-01-01", false], // a different birth date
    ["Maria", "1961-03-12", false], // the family name is missing
    ["", "1961-03-12", false],
  ];
  for (const [name, birthDate, expected] of cases) assert.equal(samePatient(name, birthDate, maria), expected, `${name} ${birthDate}`);
});

test("a patient record without a family name or birth date never passes", () => {
  assert.equal(samePatient("Maria", "1961-03-12", { family: "", given: ["Maria"], birthDate: "1961-03-12" }), false);
  assert.equal(samePatient("Maria Beispiel", "", { ...maria, birthDate: "" }), false);
});

test("umlauts and titles do not break the match", () => {
  const mueller = { family: "Müller", given: ["Jürgen"], birthDate: "1950-05-05" };
  assert.equal(samePatient("Juergen Mueller", "1950-05-05", mueller), true);
  assert.equal(samePatient("Dr. Jürgen Müller", "1950-05-05", mueller), true);
});

test("uploadHash is the SHA-256 hex of the upload", () => {
  assert.equal(uploadHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(uploadHash(scenario("lab-result-max-beispiel.md")).length, 64);
});

test("decomposed umlauts and Austrian female titles still match", () => {
  const mueller = { family: "Müller", given: ["Jürgen"], birthDate: "1950-05-05" };
  assert.equal(samePatient("Ju\u0308rgen Mu\u0308ller", "1950-05-05", mueller), true);
  assert.equal(samePatient("Dr.in Mag.a Jürgen Müller", "1950-05-05", mueller), true);
});
