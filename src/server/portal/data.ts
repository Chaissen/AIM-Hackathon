import type { Patient } from "fhir/r4";

import { env } from "@/env";
import type { DocumentType } from "@/lib/document-types";
import { anonymousBrowser, recordAudit } from "@/server/audit/record";
import { db } from "@/server/db";
import { fhirFetch } from "@/server/fhir/client";
import { linkIsLive } from "@/server/requests/lifecycle";
import { findRequestByToken, type RequestRow } from "@/server/requests/service";

// Data the portal pages need. The SMS log does not exist yet, so listSms returns nothing until T06 lands.

/** What the outside person may see before the identity check: the requester and the clinic only. */
export type PublicRequest = { requester: string; clinic: string; expiresAt: Date };

/** What the outside person sees after the identity check passed. */
export type AnswerContext = PublicRequest & {
  docType: DocumentType;
  patient: { name: string; birthDate: string };
};

export type SmsMessage = { id: number; to: string; body: string; sentAt: Date };

const publicPart = (request: RequestRow): PublicRequest => ({
  requester: request.requesterName,
  clinic: env.CLINIC_NAME,
  expiresAt: request.expiresAt,
});

/**
 * The request behind a link, if the link still works, and `link_opened` in the audit log for every known link.
 * `ip` is the browser's address; only a keyed hash of it is stored.
 */
export async function findPublicRequest(token: string, { ip }: { ip: string | null }): Promise<PublicRequest | null> {
  const request = await findRequestByToken(db, token);
  if (!request) return null;
  const live = linkIsLive(request.state);
  await recordAudit(db, {
    event: "link_opened",
    requestId: request.id,
    actor: anonymousBrowser(ip),
    outcome: live ? "shown" : "refused",
    detail: { state: request.state },
  });
  return live ? publicPart(request) : null;
}

/** The request behind a link that still works, for the login. Unlike findPublicRequest, it writes no `link_opened`. */
export async function findOpenRequest(token: string): Promise<RequestRow | null> {
  const request = await findRequestByToken(db, token);
  return request && linkIsLive(request.state) ? request : null;
}

/**
 * The request bound to the ID Austria session, only while it is `verified` and only for the person it is bound to.
 * Reads the patient from the FHIR server.
 */
export async function findAnswerContext(
  token: string,
  session: { requestId: number; personNumber: string },
): Promise<AnswerContext | null> {
  const request = await findRequestByToken(db, token);
  if (request?.id !== session.requestId || request.state !== "verified") return null;
  if (!request.personNumber || request.personNumber !== session.personNumber) return null;

  const patient = await fhirFetch<Patient>(`Patient/${encodeURIComponent(request.patientId)}`);
  if (!patient.birthDate) throw new Error(`Patient ${request.patientId} has no birth date`);
  // The official name if the record has one, as the patient check compares (`readFhirPatient`).
  const name = patient.name?.find((n) => n.use === "official") ?? patient.name?.[0];
  return {
    ...publicPart(request),
    docType: request.docType,
    patient: { name: [...(name?.given ?? []), name?.family].filter(Boolean).join(" "), birthDate: patient.birthDate },
  };
}

// TODO(T06): read the SMS the request service would have sent.
export async function listSms(): Promise<SmsMessage[]> {
  return [];
}
