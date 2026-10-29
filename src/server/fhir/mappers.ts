import { randomUUID } from "node:crypto";

import type { Attachment, DiagnosticReport, DocumentReference, Observation, Quantity, Reference } from "fhir/r4";

import type { LabResult, LabRow, ParsedDocument, RehabReport } from "@/server/documents/types";

// Lab and rehab mappers (docs/FHIR.md, "Lab result mapping" and "Rehab report mapping").
// They only build the clinical resources. The filing (T13) creates the Practitioner and Organization,
// passes their references in, and wraps the entries into the transaction Bundle.

const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";

/** A resource with the `urn:uuid:` fullUrl it gets in the transaction Bundle. */
export type Entry<T> = { fullUrl: string; resource: T };

export type MapContext = {
  /** `Patient/maria-beispiel`, chosen by the request, never by the document. */
  patient: Reference;
  /** The organisation from the heading. */
  organization: Reference;
  /** The physician under `Validated by` or `Written by`. Null when the document names none. */
  practitioner: Reference | null;
};

const entry = <T>(resource: T): Entry<T> => ({ fullUrl: `urn:uuid:${randomUUID()}`, resource });

const reference = ({ fullUrl }: Entry<unknown>): Reference => ({ reference: fullUrl });

const markdownAttachment = (doc: ParsedDocument, title?: string): Attachment => ({
  contentType: "text/markdown",
  data: Buffer.from(doc.markdown, "utf8").toString("base64"),
  ...(title && { title }),
});

// INR has no unit, so its quantities carry only the value.
const quantity = (value: number, row: LabRow): Quantity =>
  row.ucum ? { value, unit: row.unitText, system: UCUM, code: row.ucum } : { value };

function observation(row: LabRow, doc: LabResult, context: MapContext): Observation {
  return {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
    // No `display`: jury documents may carry codes we have not looked up, and a wrong display is a validator error.
    code: { coding: [{ system: LOINC, code: row.loinc }], text: row.test },
    subject: context.patient,
    effectiveDateTime: doc.sampleTaken,
    issued: doc.reported,
    ...(context.practitioner && { performer: [context.practitioner] }),
    valueQuantity: quantity(row.value, row),
    ...(row.interpretation && {
      interpretation: [
        { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: row.interpretation }] },
      ],
    }),
    referenceRange: [
      {
        ...(row.low !== null && { low: quantity(row.low, row) }),
        ...(row.high !== null && { high: quantity(row.high, row) }),
        text: row.rangeText,
      },
    ],
  };
}

export function mapLabResult(doc: LabResult, context: MapContext) {
  const observations = doc.rows.map((row) => entry(observation(row, doc, context)));
  const diagnosticReport = entry<DiagnosticReport>({
    resourceType: "DiagnosticReport",
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB" }] }],
    code: { coding: [{ system: LOINC, code: "11502-2" }], text: doc.title },
    subject: context.patient,
    effectiveDateTime: doc.sampleTaken,
    issued: doc.reported,
    performer: [context.organization],
    ...(context.practitioner && { resultsInterpreter: [context.practitioner] }),
    result: observations.map(reference),
    ...(doc.conclusion && { conclusion: doc.conclusion }),
    presentedForm: [markdownAttachment(doc)],
  });
  return { diagnosticReport, observations };
}

/** `filedAt` is an instant with seconds and the Vienna offset, for example `2026-10-29T14:02:12+01:00`. */
export function mapRehabReport(doc: RehabReport, context: MapContext, filedAt: string) {
  return entry<DocumentReference>({
    resourceType: "DocumentReference",
    status: "current",
    docStatus: "final",
    type: { coding: [{ system: LOINC, code: "18842-5" }], text: "Rehab discharge report" },
    subject: context.patient,
    date: filedAt,
    author: [...(context.practitioner ? [context.practitioner] : []), context.organization],
    ...(doc.reason && { description: doc.reason }),
    content: [{ attachment: markdownAttachment(doc, doc.title) }],
    context: { period: { start: doc.stay.start, end: doc.stay.end } },
  });
}
