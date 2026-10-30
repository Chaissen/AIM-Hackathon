import { z } from "zod";

import { anthropicReader } from "@/server/documents/anthropic-reader";
import type { DocumentReader } from "@/server/documents/fallback";
import type { ExpectedPatient } from "@/server/documents/patient-check";
import type { Db } from "@/server/db";
import { db } from "@/server/db";
import { checkRelease } from "@/server/ehvd/release-check";
import { fhirFetch } from "@/server/fhir/client";
import type { Notice } from "@/server/matrix/notices";
import { notifyRequest } from "@/server/requests/notify";
import type { RequestRow } from "@/server/requests/service";
import { fhirFiling, mapClinical } from "./fhir-filing";
import { type FileAnswer, type ReleaseCheck } from "./ports";

/** The requested patient from the FHIR server: what the patient check compares, and the name for notices. */
export type RequestedPatient = ExpectedPatient & { display: string };

const patientResource = z.object({
  resourceType: z.literal("Patient"),
  name: z.array(z.object({ use: z.string().optional(), given: z.array(z.string()).optional(), family: z.string().optional() })).optional(),
  birthDate: z.string().optional(),
});

/** Everything the answer flow talks to. Tests pass stand-ins; the portal uses `answerDeps`. */
export type AnswerDeps = {
  db: Db;
  readPatient: (patientId: string) => Promise<RequestedPatient>;
  releaseCheck: ReleaseCheck;
  fileAnswer: FileAnswer;
  /** Posts a notice in Dr. Hofer's room. Must not throw. */
  notify: (request: RequestRow, notice: Notice) => Promise<void>;
  /**
   * The AI fallback's model (docs/ARCHITECTURE.md, "AI fallback"). Absent or null turns the fallback off, and an upload
   * the parser cannot read is refused as before. Tests pass a stand-in and never call the network.
   */
  documentReader?: DocumentReader | null;
};

/** Reads the patient by id. The official name if the resource has one, otherwise the first. */
export async function readFhirPatient(patientId: string): Promise<RequestedPatient> {
  const patient = patientResource.parse(await fhirFetch<unknown>(`Patient/${encodeURIComponent(patientId)}`));
  const name = patient.name?.find((n) => n.use === "official") ?? patient.name?.[0];
  const given = name?.given ?? [];
  const family = name?.family ?? "";
  // An empty family name or birth date never matches in the patient check, so a broken record files nothing.
  return { given, family, birthDate: patient.birthDate ?? "", display: [...given, family].filter(Boolean).join(" ") };
}

export const answerDeps: AnswerDeps = {
  db,
  readPatient: readFhirPatient,
  releaseCheck: (input) => checkRelease(input),
  fileAnswer: fhirFiling({ mapClinical }),
  notify: notifyRequest,
  // Null without ANTHROPIC_API_KEY.
  documentReader: anthropicReader(),
};
