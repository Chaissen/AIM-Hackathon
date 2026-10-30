// Loads the synthetic patients into the FHIR server: the scenario patient Maria Beispiel from track/scenario/, and
// Johann Muster and Petra Probst from scripts/fixtures/patients/, so the workspace has more than one patient to show.
// Each PUT uses the resource's id, so a second run updates the three Patients instead of adding new ones.
import { readFile } from "node:fs/promises";

import type { Patient } from "fhir/r4";

import { put } from "@/server/fhir/client";

const PATIENT_FILES = [
  "../track/scenario/patient.json",
  "./fixtures/patients/johann-muster.json",
  "./fixtures/patients/petra-probst.json",
];

for (const file of PATIENT_FILES) {
  const patient = JSON.parse(await readFile(new URL(file, import.meta.url), "utf8")) as Patient & { id: string };
  const saved = await put(patient);
  // The id only: logs never name a patient (docs/COMPLIANCE_AND_SAFETY.md).
  console.log(`Patient/${saved.id} saved`);
}
