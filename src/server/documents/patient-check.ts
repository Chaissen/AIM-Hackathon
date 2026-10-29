import { createHash } from "node:crypto";

import { isSubset, nameWords } from "@/server/identity/names";
import type { IsoDate } from "./types";

// Patient check from docs/IDENTITY.md ("M3: wrong patient"). It runs on the document and on the form input; both must pass.

export type ExpectedPatient = { family: string; given: string[]; birthDate: IsoDate };

/** The name and birth date belong to the patient: same birth date, the family name present, and no foreign name words. */
export function samePatient(docName: string, docBirthDate: string, patient: ExpectedPatient): boolean {
  const family = nameWords(patient.family);
  // An empty family name passes every subset test, so a patient record without one never matches.
  if (!family.size || !patient.birthDate) return false;
  const allNames = new Set([...family, ...nameWords(patient.given.join(" "))]);
  const docWords = nameWords(docName);
  return docBirthDate === patient.birthDate && isSubset(family, docWords) && isSubset(docWords, allNames);
}

export type PatientCheck = { pass: boolean; document: boolean; form: boolean };

/**
 * Both checks together. On `pass: false` the request service files nothing, discards the upload,
 * keeps only `uploadHash()` in the audit log (`misdelivery_caught`, `patient_mismatch`), and tells Dr. Hofer.
 */
export function checkAnswerPatient(
  document: { name: string; birthDate: string },
  form: { name: string; birthDate: string },
  patient: ExpectedPatient,
): PatientCheck {
  const doc = samePatient(document.name, document.birthDate, patient);
  const typed = samePatient(form.name, form.birthDate, patient);
  return { pass: doc && typed, document: doc, form: typed };
}

/** SHA-256 of the upload, hex. The only trace of a discarded upload that stays in the audit log. */
export const uploadHash = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");
