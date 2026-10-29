import { z } from "zod";

import { parseDateWide, parseStayWide, parseViennaDateTimeWide } from "./dates";
import { parseDocument, parsePersonLine, toNumber } from "./parse";
import type { LabResult, LabRow, ParseResult, ParsedDocument, PersonLine, RehabReport } from "./types";

// AI fallback (docs/ARCHITECTURE.md, "AI fallback"; docs/COMPLIANCE_AND_SAFETY.md, "AI rules").
// Runs only when parseDocument() cannot read a file. The model copies text out of the document; it never decides
// anything. Code then checks that every copied value appears word for word in the document and derives the
// typed fields (numbers, UCUM units, dates, interpretation) itself. A reading by the model is always held for Dr. Hofer.

const text = z.string();
const verbatim = <K extends string>(keys: readonly K[]) => z.object(Object.fromEntries(keys.map((k) => [k, text])) as Record<K, typeof text>);

/** The text columns of a `LabRow`, copied as written. Code computes `value`, `ucum`, `low`, `high`, and `interpretation`. */
const LAB_ROW_KEYS = ["test", "valueText", "unitText", "rangeText", "loinc"] as const satisfies readonly (keyof LabRow)[];

/**
 * What the model returns: the parser types with every field as the text written in the document, `""` when absent.
 * Person lines are their `raw` text, dates and the stay their text as written.
 */
export const modelReadingSchema = z.object({
  type: z.enum(["lab-result", "rehab-report", "other"]),
  title: text,
  organisation: text,
  kind: text,
  patientName: text,
  patientBirthDate: text,
  fields: z.array(z.object({ key: text, value: text })),
  // LabResult
  sampleTaken: text,
  reported: text,
  rows: z.array(verbatim(LAB_ROW_KEYS)),
  conclusion: text,
  validatedBy: text,
  // RehabReport
  stay: text,
  reason: text,
  sections: z.array(z.object({ heading: text, text })),
  writtenBy: text,
  sentBy: text,
} satisfies Partial<Record<keyof LabResult | keyof RehabReport | `patient${string}`, z.ZodType>>);

export type ModelReading = z.infer<typeof modelReadingSchema>;

/** Sends the document to a language model and returns its raw answer, which is checked against `modelReadingSchema`. */
export type DocumentReader = (markdown: string) => Promise<{ model: string; output: unknown }>;

// Reasons for the held notice (src/server/matrix/notices.ts). They go into Matrix, so they name no document content.
export const HELD_REASON = "The parser could not read the document, so a language model read it. Check every value before you accept it.";
export const UNVERIFIED_REASON = "A language model read the document, but some values it returned are not in the document. Check the file itself.";

export type FallbackResult =
  /** The parser read the document, or no model is configured, or the model gave no usable answer. */
  | ParseResult
  /** The model read the document and every value appears in it. Held for Dr. Hofer. */
  | { ok: true; document: ParsedDocument; held: { by: "model"; model: string; reason: string } }
  /**
   * The model read the document, but a value is not in it or the typed fields cannot be derived. Held for Dr. Hofer
   * with the file only. `unverified` quotes document text: show it in the widget, never in Matrix or the audit log.
   */
  | { ok: false; errors: string[]; held: { by: "model"; model: string; reason: string; unverified: string[] } };

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const ALNUM = /[\p{L}\p{N}]/u;

/**
 * True when `value` appears word for word in `source`: same characters and case, any run of white space counts as one
 * space, and it is not part of a longer word or number (`301-6` is not in `6301-6`, `1.0` is not in `11.05`).
 */
export function appearsVerbatim(value: string, source: string): boolean {
  const needle = collapse(value);
  if (!needle) return true;
  const hay = collapse(source);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const before = hay[at - 1] ?? "";
    const after = hay[at + needle.length] ?? "";
    const openStart = !ALNUM.test(needle[0]) || !ALNUM.test(before);
    const openEnd = !ALNUM.test(needle[needle.length - 1]) || !ALNUM.test(after);
    if (openStart && openEnd) return true;
  }
  return false;
}

/**
 * The hard check. Every text the model returned must appear word for word in the document, and every lab row needs a
 * LOINC code that does. Returns one entry per failing value, for example `rows[1].valueText: "35"`. Empty means verified.
 */
export function unverifiedValues(reading: ModelReading, source: string): string[] {
  const failures: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (path !== "type" && !appearsVerbatim(value, source)) failures.push(`${path}: ${JSON.stringify(value)}`);
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(reading, "");
  reading.rows.forEach((row, i) => {
    if (!/^\d{1,7}-\d$/.test(row.loinc)) failures.push(`rows[${i}].loinc: ${JSON.stringify(row.loinc)} is not a LOINC code`);
  });
  return failures;
}

const person = (raw: string): PersonLine | null => (raw ? parsePersonLine(raw) : null);

function labRow(row: ModelReading["rows"][number], n: number, errors: string[]): LabRow | null {
  const value = toNumber(row.valueText);
  if (value === null) {
    errors.push(`Row ${n + 1} (${row.test}): the result is not a number.`);
    return null;
  }
  // The fallback also reads "0.8 - 1.2" and "0.8–1.2", which the parser does not.
  const range = row.rangeText.match(/^\s*(-?[\d.,]+)\s*(?:to|-|–)\s*(-?[\d.,]+)\s*$/);
  const low = range ? toNumber(range[1]) : null;
  const high = range ? toNumber(range[2]) : null;
  const hasRange = low !== null && high !== null;
  return {
    test: row.test,
    value,
    valueText: row.valueText,
    ucum: row.unitText ? row.unitText.replace(/\^/g, "*") : null,
    unitText: row.unitText,
    low: hasRange ? low : null,
    high: hasRange ? high : null,
    rangeText: row.rangeText,
    loinc: row.loinc,
    interpretation: hasRange ? (value < low ? "L" : value > high ? "H" : "N") : null,
  };
}

/** Builds the parser's typed record from a verified reading. The derived fields come from code, never from the model. */
export function toDocument(reading: ModelReading, markdown: string): { document: ParsedDocument | null; errors: string[] } {
  const errors: string[] = [];
  const birthDate = parseDateWide(reading.patientBirthDate);
  if (!reading.patientName || !birthDate) errors.push("The model found no patient name and birth date.");

  const base = {
    title: reading.title,
    organisation: reading.organisation,
    kind: reading.kind.toLowerCase(),
    patient: { name: reading.patientName, birthDate: birthDate ?? "" },
    fields: Object.fromEntries(reading.fields.map((f) => [f.key, f.value])),
    markdown,
  };
  const dateTime = (label: string, value: string) => {
    const parsed = parseViennaDateTimeWide(value);
    if (!parsed) errors.push(`The model found no readable "${label}" date.`);
    return parsed ?? "";
  };

  let document: ParsedDocument;
  if (reading.type === "lab-result") {
    const rows = reading.rows.flatMap((r, n) => labRow(r, n, errors) ?? []);
    if (!reading.rows.length) errors.push("The model found no result rows.");
    document = {
      ...base,
      type: "lab-result",
      sampleTaken: dateTime("Sample taken", reading.sampleTaken),
      reported: dateTime("Reported", reading.reported),
      rows,
      conclusion: reading.conclusion || null,
      validatedBy: person(reading.validatedBy),
    };
  } else if (reading.type === "rehab-report") {
    const stay = parseStayWide(reading.stay);
    if (!stay) errors.push("The model found no readable stay.");
    document = {
      ...base,
      type: "rehab-report",
      stay: stay ?? { start: "", end: "" },
      reason: reading.reason || null,
      sections: reading.sections,
      writtenBy: person(reading.writtenBy),
      sentBy: person(reading.sentBy),
    };
  } else {
    document = { ...base, type: "other" };
  }
  return errors.length ? { document: null, errors } : { document, errors };
}

/**
 * `parseDocument()`, and when it fails and a reader is configured, the AI fallback. A model failure or an answer that
 * does not fit the schema leaves the parser's result as it was. Anything the model read comes back with `held`.
 */
export async function parseWithFallback(markdown: string, reader: DocumentReader | null): Promise<FallbackResult> {
  const parsed = parseDocument(markdown);
  if (parsed.ok || !reader) return parsed;

  let answer: { model: string; output: unknown };
  try {
    answer = await reader(markdown);
  } catch {
    return parsed;
  }
  const reading = modelReadingSchema.safeParse(answer.output);
  if (!reading.success) return parsed;

  const unverified = unverifiedValues(reading.data, markdown);
  const built = unverified.length ? { document: null, errors: [] } : toDocument(reading.data, markdown);
  return built.document
    ? { ok: true, document: built.document, held: { by: "model", model: answer.model, reason: HELD_REASON } }
    : {
        ok: false,
        errors: [...parsed.errors, ...built.errors],
        held: { by: "model", model: answer.model, reason: unverified.length ? UNVERIFIED_REASON : HELD_REASON, unverified },
      };
}
