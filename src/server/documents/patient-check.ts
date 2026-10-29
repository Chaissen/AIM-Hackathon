import { createHash } from "node:crypto";

import { isSubset, nameWords } from "@/server/identity/names";

// The patient check on the document and on the form (T11, test M3). docs/IDENTITY.md, "M3: wrong patient".

export type PatientRecord = { family: string; given: string[]; birthDate: string };
export type PatientClaim = { name: string; birthDate: string };

export function patientRecord(patient: fhir4.Patient): PatientRecord {
  const name = patient.name?.find((n) => n.use === "official") ?? patient.name?.[0];
  return { family: name?.family ?? "", given: name?.given ?? [], birthDate: patient.birthDate ?? "" };
}

export function samePatient(docName: string, docBirthDate: string, patient: PatientRecord) {
  const family = nameWords(patient.family);
  if (!family.size || !patient.birthDate) return false;
  const allNames = new Set([...family, ...nameWords(patient.given.join(" "))]);
  const docWords = nameWords(docName);
  return docBirthDate === patient.birthDate && isSubset(family, docWords) && isSubset(docWords, allNames);
}

export type PatientCheck =
  | { outcome: "pass"; uploadSha256: string }
  | { outcome: "fail"; reason: "patient_mismatch"; failed: ("document" | "form")[]; uploadSha256: string };

/**
 * Both the document and the form must name the requested patient. On a fail the caller discards the upload
 * and keeps only `uploadSha256` for `misdelivery_caught`.
 */
export function checkPatient(input: { document: PatientClaim; form: PatientClaim; patient: PatientRecord; upload: string | Uint8Array }): PatientCheck {
  const uploadSha256 = createHash("sha256").update(input.upload).digest("hex");
  const failed = (["document", "form"] as const).filter((source) => !samePatient(input[source].name, input[source].birthDate, input.patient));
  return failed.length ? { outcome: "fail", reason: "patient_mismatch", failed, uploadSha256 } : { outcome: "pass", uploadSha256 };
}
