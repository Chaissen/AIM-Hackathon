// What the parser reads from an answer. The FHIR mappers (T12, T14) build on these types.
// docs/ARCHITECTURE.md, "Document parsing", and docs/FHIR.md for the mapping.

/** A person line such as `Dr. Johanna Leitner, medical director, Reha Waldblick`. */
export type DocumentPerson = { name: string; role?: string; org?: string };

export type DocumentSection = { heading: string; text: string };

type DocumentBase = {
  /** The heading without `# `, for example `Labor Kanalstraße: lab report`. */
  title: string;
  org: string;
  /** The document kind from the heading, lower case, for example `lab report`. */
  kind: string;
  /** From the `Patient` line. `birthDate` is `YYYY-MM-DD`. */
  patient: { name: string; birthDate: string };
  /** Every `Key: value` line outside lists and tables. */
  fields: Record<string, string>;
  /** The `## ` sections as Markdown, without their `Key: value` lines. */
  sections: DocumentSection[];
  /** The whole file, for `presentedForm` and `attachment`. */
  markdown: string;
};

export type LabResultRow = {
  test: string;
  loinc: string;
  value: number;
  /** UCUM code, `10^9/L` already written as `10*9/L`. Missing for unitless tests such as INR. */
  unit?: string;
  range?: { low?: number; high?: number; text: string };
};

export type LabResult = DocumentBase & {
  type: "lab-result";
  /** `dateTime` with the Vienna offset, for example `2026-10-22T08:10:00+02:00`. */
  sampleTaken: string;
  reported: string;
  rows: LabResultRow[];
  /** Free text outside the table and the sections, for `DiagnosticReport.conclusion`. */
  conclusion?: string;
  validatedBy: DocumentPerson;
};

export type RehabReport = DocumentBase & {
  type: "rehab-report";
  /** `YYYY-MM-DD` dates. */
  stay: { start: string; end: string };
  reason?: string;
  writtenBy: DocumentPerson;
  sentBy?: DocumentPerson;
};

/** Any other document kind. It becomes a DocumentReference held for Dr. Hofer. */
export type GenericDocument = DocumentBase & { type: "generic" };

export type ParsedDocument = LabResult | RehabReport | GenericDocument;

export type ParseResult = { ok: true; document: ParsedDocument } | { ok: false; reason: string };
