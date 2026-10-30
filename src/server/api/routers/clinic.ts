import { TRPCError } from "@trpc/server";
import { desc, inArray } from "drizzle-orm";
import type { Bundle, Patient } from "fhir/r4";
import { z } from "zod";

import { env } from "@/env";
import type { DocumentType } from "@/lib/document-types";
import { patientId } from "@/lib/request-input";
import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { auditLog, bindings } from "@/server/db/schema";
import { FhirError, fhirFetch } from "@/server/fhir/client";
import { displayName } from "@/server/matrix/client";
import { listRequests } from "@/server/requests/service";

const humanName = z.object({ given: z.array(z.string()).optional(), family: z.string().optional() });
const fhirPatient = z.object({
  id: z.string(),
  name: z.array(humanName).optional(),
  birthDate: z.string().optional(),
  gender: z.string().optional(),
  address: z
    .array(z.object({ text: z.string().optional(), line: z.array(z.string()).optional(), postalCode: z.string().optional(), city: z.string().optional() }))
    .optional(),
});

const patientName = (names: z.infer<typeof humanName>[] | undefined) =>
  [...(names?.[0]?.given ?? []), names?.[0]?.family].filter(Boolean).join(" ");

/** "Musterstraße 1, 1000 Beispielstadt": the address's text, or its lines and then postal code and city. */
function formatAddress(address: z.infer<typeof fhirPatient>["address"]): string | null {
  const first = address?.[0];
  if (!first) return null;
  const formatted = first.text ?? [...(first.line ?? []), [first.postalCode, first.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return formatted || null;
}

/** A person outside the network that the caller asked for documents: one row per given name, family name, and organisation. */
type Contact = {
  given: string;
  family: string;
  org: string;
  /** The channel, address, and document type of the newest request to this person. */
  channel: "email" | "sms";
  address: string;
  docType: DocumentType;
  requests: number;
  lastRequestId: number;
  lastRequestedAt: Date;
  /** `bindings` has a person number for this person at this organisation: someone answered as them before. */
  verified: boolean;
};

// The key `bindings` uses. The request service stores the names as the widget sent them, already trimmed.
const contactKey = (p: { given: string; family: string; org: string }) => JSON.stringify([p.given, p.family, p.org]);

export const clinicRouter = createTRPCRouter({
  me: clinicProcedure.query(async ({ ctx }) => ({
    mxid: ctx.actor.mxid,
    displayName: (await displayName(ctx.actor.mxid)) ?? ctx.actor.mxid,
    clinic: env.CLINIC_NAME,
  })),
  patients: clinicProcedure.query(async () => {
    const bundle = await fhirFetch<Bundle<Patient>>("Patient?_count=50&_sort=family");
    return (bundle.entry ?? []).flatMap(({ resource: patient }) =>
      patient?.id ? [{ id: patient.id, name: patientName(patient.name), birthDate: patient.birthDate ?? null }] : [],
    );
  }),
  patient: clinicProcedure.input(z.object({ id: patientId })).query(async ({ input }) => {
    const raw = await fhirFetch<unknown>(`Patient/${input.id}`).catch((error: unknown) => {
      // HAPI answers 410 for a deleted Patient.
      if (error instanceof FhirError && (error.status === 404 || error.status === 410)) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Patient ${input.id} does not exist` });
      }
      throw error;
    });
    const parsed = fhirPatient.safeParse(raw);
    if (!parsed.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `The FHIR server returned an unreadable Patient ${input.id}` });
    const patient = parsed.data;
    return {
      id: patient.id,
      name: patientName(patient.name),
      birthDate: patient.birthDate ?? null,
      gender: patient.gender ?? null,
      address: formatAddress(patient.address),
    };
  }),
  contacts: clinicProcedure.query(async ({ ctx }): Promise<Contact[]> => {
    const rows = await listRequests(ctx.db, ctx.actor.mxid);
    if (!rows.length) return [];
    const orgs = [...new Set(rows.map((r) => r.org))];
    const known = await ctx.db.select({ given: bindings.given, family: bindings.family, org: bindings.org }).from(bindings).where(inArray(bindings.org, orgs));
    const verified = new Set(known.map(contactKey));
    const contacts = new Map<string, Contact>();
    // Newest first, so the first request of a person is their newest.
    for (const r of rows) {
      const key = contactKey(r);
      const contact = contacts.get(key);
      if (contact) contact.requests++;
      else {
        contacts.set(key, {
          given: r.given,
          family: r.family,
          org: r.org,
          channel: r.channel,
          address: r.address,
          docType: r.docType,
          requests: 1,
          lastRequestId: r.id,
          lastRequestedAt: r.createdAt,
          verified: verified.has(key),
        });
      }
    }
    return [...contacts.values()];
  }),
  audit: clinicProcedure.query(({ ctx }) => ctx.db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(500)),
});
