import { z } from "zod";

import type { DocumentType } from "@/lib/document-types";

// Reads a filed answer back from its FHIR resource (docs/FHIR.md, "Lab result mapping" and "Rehab report mapping"):
// the DiagnosticReport carries the uploaded Markdown in `presentedForm`, the DocumentReference in `content.attachment`.

const attachment = z.object({ contentType: z.string().optional(), data: z.string().optional(), title: z.string().optional() });

/** The fields of a filed DiagnosticReport or DocumentReference that ordy reads. Parse FHIR JSON with it before use. */
export const filedResource = z.discriminatedUnion("resourceType", [
  z.object({
    resourceType: z.literal("DiagnosticReport"),
    id: z.string().optional(),
    issued: z.string().optional(),
    code: z.object({ text: z.string().optional() }).optional(),
    presentedForm: z.array(attachment).optional(),
  }),
  z.object({
    resourceType: z.literal("DocumentReference"),
    id: z.string().optional(),
    date: z.string().optional(),
    type: z.object({ text: z.string().optional() }).optional(),
    content: z.array(z.object({ attachment })).optional(),
  }),
]);
type FiledResource = z.infer<typeof filedResource>;

type FiledDocument = { type: DocumentType; title: string | null; date: string | null; markdown: string | null };

type Attachment = z.infer<typeof attachment>;

const isMarkdown = (a: Attachment) => a.contentType?.toLowerCase().startsWith("text/markdown") ?? false;

/** The document type, title, date, and Markdown of a filed answer. `markdown` is null without a Markdown attachment. */
export function readFiled(resource: FiledResource): FiledDocument {
  const decode = (attachments: Attachment[]) => {
    const data = attachments.find(isMarkdown)?.data;
    return data ? Buffer.from(data, "base64").toString("utf8") : null;
  };
  switch (resource.resourceType) {
    case "DiagnosticReport":
      return { type: "lab-result", title: resource.code?.text ?? null, date: resource.issued ?? null, markdown: decode(resource.presentedForm ?? []) };
    case "DocumentReference": {
      const attachments = (resource.content ?? []).map((c) => c.attachment);
      const title = attachments.find(isMarkdown)?.title ?? resource.type?.text ?? null;
      return { type: "rehab-report", title, date: resource.date ?? null, markdown: decode(attachments) };
    }
    default:
      return resource satisfies never;
  }
}

// jsonb keeps no key order, so the resources of `answer_filed` are listed by type: the document, its Observations, the
// Provenance, the Task, then the parties. `Array.prototype.sort` is stable, so within a type they keep their order.
const RESOURCE_ORDER = ["DiagnosticReport", "DocumentReference", "Observation", "Provenance", "Task", "Practitioner", "Organization"];

/** Sorts `Type/id` references in that order. */
export function byResourceType(a: string, b: string): number {
  const rank = (reference: string) => {
    const index = RESOURCE_ORDER.indexOf(reference.slice(0, reference.indexOf("/")));
    return index === -1 ? RESOURCE_ORDER.length : index;
  };
  return rank(a) - rank(b);
}
