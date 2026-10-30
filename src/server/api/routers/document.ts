import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-types";
import { patientId } from "@/lib/request-input";
import { ownRequestProcedure } from "@/server/api/own-request";
import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { auditLog, heldAnswers } from "@/server/db/schema";
import { byResourceType, filedResource, readFiled } from "@/server/documents/filed";
import { type DocumentView, toDocumentView } from "@/server/documents/view";
import { FhirError, fhirFetch } from "@/server/fhir/client";
import { filedReferences } from "@/server/metrics/audit";

// The documents behind requests and patients. A held answer's text comes from `held_answers`, a filed answer's from the
// FHIR resource that its `answer_filed` entry names as `output`.

type Unavailable = "fhir_unreachable" | "not_found";

type DocumentResult =
  | { status: "none" }
  | { status: "held"; document: DocumentView; original: string; sender: string; reason: string; sentAt: Date }
  | { status: "filed"; document: DocumentView; original: string; reference: string; filedAt: Date }
  | { status: "unavailable"; reason: Unavailable | "unreadable" };

type FiledResources =
  | { status: "none" }
  | { status: "ok"; resources: { reference: string; resourceType: string; resource: Record<string, unknown> }[] }
  | { status: "unavailable"; reason: Unavailable };

type PatientDocument = {
  reference: string;
  type: DocumentType;
  title: string;
  date: string | null;
  document: DocumentView | null;
  original: string | null;
};
type PatientDocuments = { status: "ok"; documents: PatientDocument[] } | { status: "unavailable" };

// HAPI answers 410 for a deleted resource.
const unavailable = (error: unknown): Unavailable =>
  error instanceof FhirError && (error.status === 404 || error.status === 410) ? "not_found" : "fhir_unreachable";

const anyResource = z.looseObject({ resourceType: z.string() });
const answerFiled = z.object({ output: z.string() });
// A searchset may carry an OperationOutcome entry next to the matches, so each resource is parsed on its own.
const searchset = z.object({ entry: z.array(z.object({ resource: z.unknown() })).optional() });

const filedEntries = (requestId: number) => and(eq(auditLog.requestId, requestId), eq(auditLog.event, "answer_filed"));

export const documentRouter = createTRPCRouter({
  forRequest: ownRequestProcedure.query(async ({ ctx }): Promise<DocumentResult> => {
    const [held] = await ctx.db.select().from(heldAnswers).where(eq(heldAnswers.requestId, ctx.request.id));
    if (held) {
      const answer = toDocumentView(held.markdown);
      if (!answer) return { status: "unavailable", reason: "unreadable" };
      const sender = `${held.sender.givenName} ${held.sender.familyName}`;
      return { status: "held", ...answer, sender, reason: held.reason, sentAt: held.sentAt };
    }

    const [filed] = await ctx.db.select().from(auditLog).where(filedEntries(ctx.request.id)).limit(1);
    if (!filed) return { status: "none" };
    const detail = answerFiled.safeParse(filed.detail);
    if (!detail.success) return { status: "unavailable", reason: "not_found" };

    const reference = detail.data.output;
    let resource: unknown;
    try {
      resource = await fhirFetch<unknown>(reference);
    } catch (error) {
      return { status: "unavailable", reason: unavailable(error) };
    }
    const parsed = filedResource.safeParse(resource);
    const markdown = parsed.success ? readFiled(parsed.data).markdown : null;
    const answer = markdown === null ? null : toDocumentView(markdown);
    if (!answer) return { status: "unavailable", reason: "unreadable" };
    return { status: "filed", ...answer, reference, filedAt: filed.at };
  }),

  filedResources: ownRequestProcedure.query(async ({ ctx }): Promise<FiledResources> => {
    const references = filedReferences(await ctx.db.select().from(auditLog).where(filedEntries(ctx.request.id))).sort(byResourceType);
    if (!references.length) return { status: "none" };
    try {
      const resources = await Promise.all(
        references.map(async (reference) => {
          const resource = anyResource.parse(await fhirFetch<unknown>(reference));
          return { reference, resourceType: resource.resourceType, resource };
        }),
      );
      return { status: "ok", resources };
    } catch (error) {
      return { status: "unavailable", reason: unavailable(error) };
    }
  }),

  forPatient: clinicProcedure
    .input(z.object({ patientId }))
    .query(async ({ input }): Promise<PatientDocuments> => {
      const subject = `subject=Patient/${input.patientId}&_count=20`;
      let resources: unknown[];
      try {
        const bundles = await Promise.all(
          [`DiagnosticReport?${subject}&_sort=-issued`, `DocumentReference?${subject}&_sort=-date`].map(async (search) =>
            searchset.parse(await fhirFetch<unknown>(search)),
          ),
        );
        resources = bundles.flatMap((bundle) => (bundle.entry ?? []).map((entry) => entry.resource));
      } catch {
        return { status: "unavailable" };
      }
      const documents = resources.flatMap((raw): PatientDocument[] => {
        const parsed = filedResource.safeParse(raw);
        if (!parsed.success || !parsed.data.id) return [];
        const filed = readFiled(parsed.data);
        const answer = filed.markdown === null ? null : toDocumentView(filed.markdown);
        return [
          {
            reference: `${parsed.data.resourceType}/${parsed.data.id}`,
            type: filed.type,
            title: answer?.document.title ?? filed.title ?? DOCUMENT_TYPES[filed.type].label,
            date: filed.date,
            document: answer?.document ?? null,
            original: answer?.original ?? null,
          },
        ];
      });
      const time = (d: PatientDocument) => (d.date ? Date.parse(d.date) : Number.NEGATIVE_INFINITY);
      return { status: "ok", documents: documents.sort((a, b) => time(b) - time(a)) };
    }),
});
