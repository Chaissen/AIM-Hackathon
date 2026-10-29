import { randomUUID } from "node:crypto";

import type {
  Attachment,
  CodeableConcept,
  DiagnosticReport,
  DocumentReference,
  FhirResource,
  Observation,
  ObservationReferenceRange,
  Quantity,
  Reference,
} from "fhir/r4";

import type { LabResult, LabRow, ParsedDocument, RehabReport, ViennaDateTime } from "@/server/documents/types";

// Lab and rehab mappers (docs/FHIR.md, "Lab result mapping" and "Rehab report mapping").
// They only build the clinical resources. The filing (T13) creates the Practitioner and Organization,
// passes their references in, and wraps the entries into the transaction Bundle.

const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";

/** A resource with the `urn:uuid:` fullUrl it gets in the transaction Bundle. */
export type Entry<T extends FhirResource> = { fullUrl: `urn:uuid:${string}`; resource: T };

/** Reference values, such as `Patient/maria-beispiel` or the `urn:uuid:` fullUrl of another Bundle entry. */
export type MapContext = {
  /** `Patient/maria-beispiel`, chosen by the request, never by the document. */
  patient: string;
  /** The organisation from the heading. */
  organization: string;
  /** The physician under `Validated by` or `Written by`. Null when the document names none. */
  practitioner: string | null;
};

export type LabResultEntries = { diagnosticReport: Entry<DiagnosticReport>; observations: Entry<Observation>[] };

// An instant needs seconds and an offset (docs/FHIR.md, validator traps).
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const entry = <T extends FhirResource>(resource: T): Entry<T> => ({ fullUrl: `urn:uuid:${randomUUID()}`, resource });

// A new object for every use, so no two resources share one.
const ref = (reference: string): Reference => ({ reference });

/** Optional elements may also be null. Required ones may not, so they never drop out. */
type Draft<T> = { [K in keyof T]: undefined extends T[K] ? T[K] | null : T[K] };

/**
 * Leaves out the elements that are null, undefined, or an empty string, because FHIR JSON allows no empty values
 * (`ele-1`) and a jury document may leave a cell empty. Typed by the element, so a misspelled key fails the typecheck.
 */
const compact = <T extends object>(element: Draft<T>): T =>
  Object.fromEntries(Object.entries(element).filter(([, value]) => value !== null && value !== undefined && value !== "")) as T;

const markdownAttachment = (doc: ParsedDocument, title?: string): Attachment =>
  compact<Attachment>({
    // RFC 7763 asks for the charset, and the documents contain letters such as ß.
    contentType: "text/markdown; charset=utf-8",
    data: Buffer.from(doc.markdown, "utf8").toString("base64"),
    title,
  });

// INR has no unit, so its quantities carry only the value.
const quantity = (value: number, row: LabRow): Quantity =>
  row.ucum ? { value, unit: row.unitText, system: UCUM, code: row.ucum } : { value };

// The parser gives both bounds or neither. A row without bounds and without text gets no range (`ref-1`).
function referenceRange(row: LabRow): ObservationReferenceRange[] | null {
  const range = compact<ObservationReferenceRange>({
    low: row.low === null ? null : quantity(row.low, row),
    high: row.high === null ? null : quantity(row.high, row),
    text: row.rangeText,
  });
  return Object.keys(range).length ? [range] : null;
}

function observation(row: LabRow, doc: LabResult, context: MapContext): Observation {
  return compact<Observation>({
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
    // No `display`: jury documents may carry codes we have not looked up, and a wrong display is a validator error.
    code: compact<CodeableConcept>({ coding: [{ system: LOINC, code: row.loinc }], text: row.test }),
    subject: ref(context.patient),
    effectiveDateTime: doc.sampleTaken,
    issued: doc.reported,
    performer: context.practitioner ? [ref(context.practitioner)] : null,
    valueQuantity: quantity(row.value, row),
    interpretation: row.interpretation
      ? [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: row.interpretation }] }]
      : null,
    referenceRange: referenceRange(row),
  });
}

export function mapLabResult(doc: LabResult, context: MapContext): LabResultEntries {
  const observations = doc.rows.map((row) => entry(observation(row, doc, context)));
  const diagnosticReport = entry(
    compact<DiagnosticReport>({
      resourceType: "DiagnosticReport",
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB" }] }],
      code: { coding: [{ system: LOINC, code: "11502-2" }], text: doc.title },
      subject: ref(context.patient),
      effectiveDateTime: doc.sampleTaken,
      issued: doc.reported,
      performer: [ref(context.organization)],
      resultsInterpreter: context.practitioner ? [ref(context.practitioner)] : null,
      result: observations.map((o) => ref(o.fullUrl)),
      conclusion: doc.conclusion,
      presentedForm: [markdownAttachment(doc)],
    }),
  );
  return { diagnosticReport, observations };
}

/** `filedAt` is an instant with seconds and the Vienna offset, for example `2026-10-29T14:02:12+01:00`. */
export function mapRehabReport(doc: RehabReport, context: MapContext, filedAt: ViennaDateTime): Entry<DocumentReference> {
  if (!INSTANT.test(filedAt)) throw new Error(`filedAt "${filedAt}" is not an instant such as 2026-10-29T14:02:12+01:00.`);
  return entry(
    compact<DocumentReference>({
      resourceType: "DocumentReference",
      status: "current",
      docStatus: "final",
      type: { coding: [{ system: LOINC, code: "18842-5" }], text: "Rehab discharge report" },
      subject: ref(context.patient),
      date: filedAt,
      author: (context.practitioner ? [context.practitioner, context.organization] : [context.organization]).map(ref),
      description: doc.reason,
      content: [{ attachment: markdownAttachment(doc, doc.title) }],
      context: { period: { start: doc.stay.start, end: doc.stay.end } },
    }),
  );
}
