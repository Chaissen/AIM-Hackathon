import type { Patient } from "fhir/r4";

import type { ExpectedPatient } from "@/server/documents/patient-check";
import type { Db } from "@/server/db";
import { db } from "@/server/db";
import { fhirFetch } from "@/server/fhir/client";
import type { Notice } from "@/server/matrix/notices";
import { notifyRequest } from "@/server/requests/notify";
import type { RequestRow } from "@/server/requests/service";
import { fhirFiling } from "./fhir-filing";
import { type FileAnswer, mapClinicalNotConnected, type ReleaseCheck, releaseCheckNotConnected } from "./ports";

/** The requested patient from the FHIR server: what the patient check compares, and the name for notices. */
export type RequestedPatient = ExpectedPatient & { display: string };

/** Everything the answer flow talks to. Tests pass stand-ins; the portal uses `answerDeps`. */
export type AnswerDeps = {
  db: Db;
  readPatient: (patientId: string) => Promise<RequestedPatient>;
  releaseCheck: ReleaseCheck;
  fileAnswer: FileAnswer;
  /** Posts a notice in Dr. Hofer's room. Must not throw. */
  notify: (request: RequestRow, notice: Notice) => Promise<void>;
};

/** Reads the patient by id. The official name if the resource has one, otherwise the first. */
export async function readFhirPatient(patientId: string): Promise<RequestedPatient> {
  const patient = await fhirFetch<Patient>(`Patient/${encodeURIComponent(patientId)}`);
  const name = patient.name?.find((n) => n.use === "official") ?? patient.name?.[0];
  const given = name?.given ?? [];
  const family = name?.family ?? "";
  // An empty family name or birth date never matches in the patient check, so a broken record files nothing.
  return { given, family, birthDate: patient.birthDate ?? "", display: [...given, family].filter(Boolean).join(" ") };
}

// TODO(T15, #44): pass checkRelease. TODO(T12, T14, #30): pass mapLabResult and mapRehabReport.
export const answerDeps: AnswerDeps = {
  db,
  readPatient: readFhirPatient,
  releaseCheck: releaseCheckNotConnected,
  fileAnswer: fhirFiling({ mapClinical: mapClinicalNotConnected }),
  notify: notifyRequest,
};
