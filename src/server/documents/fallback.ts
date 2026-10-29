import MarkdownIt from "markdown-it";
import { z } from "zod";

import { parseDateWide, parseStayWide, parseViennaDateTimeWide } from "./dates";
import { isLoinc, parseDocument, parsePersonLine, toNumber } from "./parse";
import type { LabResult, LabRow, ParseResult, ParsedDocument, PersonLine, RehabReport, SafetyRefusal } from "./types";

// AI fallback (docs/ARCHITECTURE.md, "AI fallback"; docs/COMPLIANCE_AND_SAFETY.md, "AI rules").
// Runs only when parseDocument() cannot read a file for its format, never after a safety refusal. The model copies
// text out of the document; it never decides anything. Code then checks that every copied value comes from the right
// place in the document and derives the typed fields (numbers, UCUM units, dates, interpretation) itself.
// A reading by the model is always held for Dr. Hofer.

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
export const UNBUILT_REASON = "A language model read the document, but its reading does not make a complete record. Check the file itself.";

type Held = { by: "model"; model: string; reason: string };

export type FallbackResult =
  /** The parser read the document, refused it for safety, or no model is configured, or the model gave no usable answer. */
  | ParseResult
  /** The model read the document and every value comes from it. Held for Dr. Hofer. */
  | { ok: true; document: ParsedDocument; held: Held }
  /**
   * The model read the document, but a value does not come from it or the typed fields cannot be derived. Held for
   * Dr. Hofer with the file only. `unverified` quotes document text: show it in the widget, never in Matrix or the audit log.
   */
  | { ok: false; errors: string[]; held: Held & { unverified: string[] } };

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const WORD = /[\p{L}\p{N}]/u;
/** Characters that join two words or numbers into one: `3.1`, `1,0`, `6301-6`, `10^9/L`. */
const JOIN = /[.,\-^/]/;
/** True when the text at `i` continues a word, number, code, or unit, read outward from the match by `step`. */
const continues = (hay: string, i: number, step: 1 | -1) => WORD.test(hay[i] ?? "") || (JOIN.test(hay[i] ?? "") && WORD.test(hay[i + step] ?? ""));

/**
 * True when `value` appears word for word in `source`: same characters and case, any run of white space counts as one
 * space, and it is not part of a longer word, number, code, or unit. `301-6` is not in `6301-6`, `3` is not in `3.1`,
 * `03` is not in `12.03.1961`, and `L` is not in `10^9/L`. An empty value is never in the source.
 */
export function appearsVerbatim(value: string, source: string): boolean {
  const needle = collapse(value);
  if (!needle) return false;
  const hay = collapse(source);
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const end = at + needle.length;
    const openStart = !WORD.test(needle[0]) || !continues(hay, at - 1, -1);
    const openEnd = !WORD.test(needle[needle.length - 1]) || !continues(hay, end, 1);
    if (openStart && openEnd) return true;
  }
  return false;
}

/** The places a value may come from: headings, `key: value` lines, and the body rows of each table, white space collapsed. */
type Source = { headings: string[]; keyLines: { key: string; value: string }[]; tables: string[][][] };

const md = new MarkdownIt();
const KEY_LINE = /^([A-Za-z][A-Za-z' ]{0,40}):\s+(.+)$/;
/** Keys that name the patient, in the scenario format and in others, for example `Patient name:`. */
const PATIENT_KEY = /^(patient|patient name|patient's name|name of (the )?patient)$/i;
const BIRTH_KEY = /birth|born|\bdob\b/i;

function readSource(markdown: string): Source {
  const source: Source = { headings: [], keyLines: [], tables: [] };
  const tokens = md.parse(markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n"), {});
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let inBody = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "table_open") source.tables.push((table = []));
    else if (t.type === "table_close") table = null;
    else if (t.type === "tbody_open") inBody = true;
    else if (t.type === "tbody_close") inBody = false;
    else if (t.type === "tr_open") row = [];
    else if (t.type === "tr_close") {
      if (table && row && inBody) table.push(row);
      row = null;
    } else if (t.type === "inline" && row) row.push(collapse(t.content));
    else if (t.type === "inline" && tokens[i - 1]?.type === "heading_open") source.headings.push(collapse(t.content));
    else if (t.type === "inline") {
      for (const line of t.content.split("\n")) {
        const m = collapse(line).match(KEY_LINE);
        if (m) source.keyLines.push({ key: m[1].trim(), value: m[2].trim() });
      }
    }
  }
  return source;
}

/**
 * Safety refusals the parser cannot see in a format it does not know. Like the parser's, these never go to the model:
 * more than one table, a key on more than one line with different values, or more than one line naming a patient.
 */
function sourceRefusals(source: Source): { safety: SafetyRefusal; error: string }[] {
  const refusals: { safety: SafetyRefusal; error: string }[] = [];
  if (source.tables.length > 1) refusals.push({ safety: "several-tables", error: "The file has more than one table. Put all results in one table." });
  const seen = new Map<string, string>();
  const repeated = new Set<string>();
  for (const { key, value } of source.keyLines) {
    const k = key.toLowerCase();
    if (seen.has(k) && seen.get(k) !== value) repeated.add(key);
    else seen.set(k, value);
  }
  for (const key of repeated) refusals.push({ safety: "repeated-key", error: `The file has more than one "${key}:" line.` });
  const patients = new Set(source.keyLines.filter((l) => PATIENT_KEY.test(l.key)).map((l) => l.value));
  if (patients.size > 1) refusals.push({ safety: "several-patients", error: "The file names more than one patient." });
  return refusals;
}

/** A distinct table column for each lab row field, or null. `candidates[f]` are the columns that match field `f` in every row. */
function assignColumns(candidates: number[][]): number[] | null {
  const pick = (f: number, used: Set<number>): number[] | null => {
    if (f === candidates.length) return [];
    for (const c of candidates[f]) {
      if (used.has(c)) continue;
      const rest = pick(f + 1, new Set([...used, c]));
      if (rest) return [c, ...rest];
    }
    return null;
  };
  return pick(0, new Set());
}

/** Each reading row must match one source row, in order, and each field one column of the table, the same in every row. */
function unverifiedRows(rows: ModelReading["rows"], table: string[][]): string[] {
  if (rows.length !== table.length) return [`rows: ${rows.length} rows, but the table has ${table.length}`];
  const width = Math.max(0, ...table.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, c) => c);
  const matches = (f: (typeof LAB_ROW_KEYS)[number], c: number) => rows.map((row, i) => collapse(row[f]) === (table[i][c] ?? ""));
  const candidates = LAB_ROW_KEYS.map((f) => columns.filter((c) => matches(f, c).every(Boolean)));
  const failures: string[] = [];
  LAB_ROW_KEYS.forEach((f, n) => {
    if (candidates[n].length) return;
    // Report the rows that differ from the column that fits best.
    const best = columns.map((c) => matches(f, c)).sort((a, b) => b.filter(Boolean).length - a.filter(Boolean).length)[0] ?? [];
    rows.forEach((row, i) => {
      if (!best[i]) failures.push(`rows[${i}].${f}: ${JSON.stringify(row[f])}`);
    });
  });
  if (!failures.length && !assignColumns(candidates)) failures.push("rows: two fields come from the same table column");
  rows.forEach((row, i) => {
    if (!isLoinc(row.loinc)) failures.push(`rows[${i}].loinc: ${JSON.stringify(row.loinc)} is not a LOINC code`);
  });
  return failures;
}

/**
 * The hard check. Each value must come from its own place in the document: lab rows from one table row each, with no
 * row left out, the patient from the line that names the patient, key fields from one `key: value` line, the title
 * from a heading, free text word for word. Returns one entry per failing value, for example `rows[1].valueText: "35"`.
 * Empty means verified.
 */
export function unverifiedValues(reading: ModelReading, markdown: string): string[] {
  const source = readSource(markdown);
  const failures: string[] = [];
  const fail = (path: string, value: string) => failures.push(`${path}: ${JSON.stringify(value)}`);
  const lineValues = (test: (key: string) => boolean) => source.keyLines.filter((l) => test(l.key)).map((l) => l.value);
  /** A value the document may lack: `""` is fine, anything else must pass. */
  const optional = (value: string, ok: boolean, path: string) => {
    if (value && !ok) fail(path, value);
  };

  if (!source.headings.includes(collapse(reading.title))) fail("title", reading.title);
  optional(reading.organisation, appearsVerbatim(reading.organisation, reading.title), "organisation");
  optional(reading.kind, appearsVerbatim(reading.kind, reading.title), "kind");

  const patientLines = lineValues((k) => PATIENT_KEY.test(k));
  if (!patientLines.some((v) => appearsVerbatim(reading.patientName, v))) fail("patientName", reading.patientName);
  const birthLines = lineValues((k) => PATIENT_KEY.test(k) || BIRTH_KEY.test(k));
  if (!birthLines.some((v) => appearsVerbatim(reading.patientBirthDate, v))) fail("patientBirthDate", reading.patientBirthDate);

  reading.fields.forEach((f, i) => {
    if (!source.keyLines.some((l) => l.key === collapse(f.key) && l.value === collapse(f.value))) fail(`fields[${i}]`, `${f.key}: ${f.value}`);
  });
  const values = new Set(source.keyLines.map((l) => l.value));
  for (const key of ["sampleTaken", "reported", "validatedBy", "stay", "reason", "writtenBy", "sentBy"] as const) {
    optional(reading[key], values.has(collapse(reading[key])), key);
  }
  optional(reading.conclusion, appearsVerbatim(reading.conclusion, markdown), "conclusion");
  reading.sections.forEach((s, i) => {
    if (!source.headings.includes(collapse(s.heading))) fail(`sections[${i}].heading`, s.heading);
    optional(s.text, appearsVerbatim(s.text, markdown), `sections[${i}].text`);
  });

  if (reading.type === "lab-result") {
    // sourceRefusals() has already refused a file with more than one table.
    if (source.tables.length === 1) failures.push(...unverifiedRows(reading.rows, source.tables[0]));
    else failures.push("rows: the document has no table");
  } else if (reading.rows.length) failures.push("rows: only a lab result has rows");
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

/**
 * Builds the parser's typed record from a verified reading. The derived fields come from code, never from the model.
 * Not exported: the only way out is `parseWithFallback()`, which always marks the record as held.
 */
function toDocument(reading: ModelReading, markdown: string): { document: ParsedDocument | null; errors: string[] } {
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
 * `parseDocument()`, and when it fails for its format and a reader is configured, the AI fallback. A safety refusal
 * never reaches the model. A model failure or an answer that does not fit the schema leaves the parser's result as it
 * was. Anything the model read comes back with `held`.
 */
export async function parseWithFallback(markdown: string, reader: DocumentReader | null): Promise<FallbackResult> {
  const parsed = parseDocument(markdown);
  if (parsed.ok || !reader || parsed.safety.length) return parsed;
  const refusals = sourceRefusals(readSource(markdown));
  if (refusals.length) {
    return { ok: false, errors: [...parsed.errors, ...refusals.map((r) => r.error)], safety: [...new Set(refusals.map((r) => r.safety))] };
  }

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
  const held = { by: "model" as const, model: answer.model };
  return built.document
    ? { ok: true, document: built.document, held: { ...held, reason: HELD_REASON } }
    : { ok: false, errors: [...parsed.errors, ...built.errors], held: { ...held, reason: unverified.length ? UNVERIFIED_REASON : UNBUILT_REASON, unverified } };
}
