// Typed records the document parser returns (docs/ARCHITECTURE.md, "Document parsing").
// The FHIR mappers (docs/FHIR.md) build on these types; change them only together with the mappers.

/** A `dateTime` with the Europe/Vienna offset, for example `2026-10-22T08:10:00+02:00`. */
export type ViennaDateTime = string;

/** A calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * A person line such as `Validated by: Dr. Eva Brandl, lab physician`
 * or `Written by: Dr. Johanna Leitner, medical director, Reha Waldblick`.
 */
export type PersonLine = {
  /** The value exactly as written, for example `Dr. Eva Brandl, lab physician`. */
  raw: string;
  /** Academic titles in front of the name, for example `["Dr."]`. */
  titles: string[];
  /** All words between the titles and the family name, for example `Eva` or `Eva Maria`. */
  given: string;
  /** The last word of the name, for example `Brandl`. */
  family: string;
  /** The parts after the name, for example `["medical director", "Reha Waldblick"]`. */
  details: string[];
};

type DocumentBase = {
  /** The heading without `# `, for example `Labor Kanalstraße: lab report`. */
  title: string;
  /** The heading part before the first `:`, for example `Labor Kanalstraße`. */
  organisation: string;
  /** The heading part after the first `:`, lowercased, for example `lab report`. */
  kind: string;
  /** From the `Patient:` line, split at `", born "`. */
  patient: { name: string; birthDate: IsoDate };
  /** Every `Key: value` line as written, for fields the typed records do not cover. */
  fields: Record<string, string>;
  /** The whole uploaded file, for `presentedForm` and `attachment`. */
  markdown: string;
};

export type LabRow = {
  /** Column `Test`, for example `INR (prothrombin time)`. */
  test: string;
  /** Column `Result` as a number, for example `1.0` becomes `1`. */
  value: number;
  /** Column `Result` as written, for example `1.0`. */
  valueText: string;
  /** Column `Unit` in UCUM, for example `10^9/L` becomes `10*9/L` (`ucum.ts`). Null when the column is empty, as for INR, or the unit is not on the UCUM list. */
  ucum: string | null;
  /** Column `Unit` as written. */
  unitText: string;
  /** Column `Reference range`, split at `" to "`. Null when the range cannot be read. */
  low: number | null;
  high: number | null;
  /** Column `Reference range` as written, for example `0.8 to 1.2`. */
  rangeText: string;
  /** Column `LOINC code`, for example `6301-6`. */
  loinc: string;
  /** Computed from value and range: below low is `L`, above high is `H`, otherwise `N`. Null without a range. */
  interpretation: "N" | "H" | "L" | null;
};

/** `lab report`: one table row per test. */
export type LabResult = DocumentBase & {
  type: "lab-result";
  sampleTaken: ViennaDateTime;
  reported: ViennaDateTime;
  rows: LabRow[];
  /** Free text outside the table and the key lines, for example `All values are within the reference range.` */
  conclusion: string | null;
  validatedBy: PersonLine | null;
};

/** `discharge report` from a rehab clinic. */
export type RehabReport = DocumentBase & {
  type: "rehab-report";
  /** From `Stay: 2 to 23 September 2026` or `Stay: 28 August to 12 September 2026`. */
  stay: { start: IsoDate; end: IsoDate };
  reason: string | null;
  /** Free text sections such as `## Course`, in document order. */
  sections: { heading: string; text: string }[];
  writtenBy: PersonLine | null;
  sentBy: PersonLine | null;
};

/** Any other document kind. The answer flow refuses it, because a request asks for a lab result or a discharge report. */
export type GenericDocument = DocumentBase & { type: "other" };

export type ParsedDocument = LabResult | RehabReport | GenericDocument;

/**
 * A refusal that exists to stop a misdelivery, not because the format is unknown: a known key on more than one line
 * with different values (a second `Patient:` line), a lab report with more than one table, or lines that name more
 * than one patient or birth date in any form (`patient-lines.ts`). The AI fallback never sends such a document to
 * the model (docs/ARCHITECTURE.md, "AI fallback").
 */
export type SafetyRefusal = "repeated-key" | "several-tables" | "several-patients" | "several-birth-dates";

/**
 * The parser never throws on content. `errors` names every reason the document could not be read,
 * in words the uploader can act on. `safety` lists the refusals among them that stop a misdelivery.
 */
export type ParseResult = { ok: true; document: ParsedDocument } | { ok: false; errors: string[]; safety: SafetyRefusal[] };
