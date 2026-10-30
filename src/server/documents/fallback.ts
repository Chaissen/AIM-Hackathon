import MarkdownIt from "markdown-it";
import { z } from "zod";

import { parseDateWide, parseStayWide, parseViennaDateTimeWide } from "./dates";
import { freeText, isLoinc, oneSided, parseDocument, parsePersonLine, rangeFields, rowUnit, toNumber, twoSided } from "./parse";
import { HEADER_ONLY_KEYS, IDENTITY_KEYS, headerBlock, isPatientHeading, keyLines, patientIdentity, toKeyLine, type KeyLine } from "./patient-lines";
import type { LabResult, LabRow, ParseResult, ParsedDocument, PersonLine, RehabReport, SafetyRefusal } from "./types";

// AI fallback (docs/ARCHITECTURE.md, "AI fallback"; docs/COMPLIANCE_AND_SAFETY.md, "AI rules").
// Runs only when parseDocument() cannot read a file for its format, never after a safety refusal.
// Code decides everything that carries safety or meaning: it reads the patient, the type, each field from its own key,
// each lab value from its own column, and the free text. The model reads the same document independently, and its
// reading must agree with code's in every field that carries meaning. The model can only stop a record, never choose a
// value. A record from the fallback is always held for Dr. Hofer.

const text = z.string();

/** The text columns of a `LabRow`, copied as written. Code computes `value`, `ucum`, `low`, `high`, and `interpretation`. */
const LAB_ROW_KEYS = ["test", "valueText", "unitText", "rangeText", "loinc"] as const satisfies readonly (keyof LabRow)[];
type LabRowKey = (typeof LAB_ROW_KEYS)[number];
/** Fields that come from one `key: value` line each. */
const KEY_FIELDS = ["sampleTaken", "reported", "validatedBy", "stay", "reason", "writtenBy", "sentBy"] as const satisfies readonly (
  | keyof LabResult
  | keyof RehabReport
)[];
type KeyField = (typeof KEY_FIELDS)[number];

/** What the model returns: the fields of the parser types that carry meaning, each as written, `""` when absent. */
export const modelReadingSchema = z.object({
  type: z.enum(["lab-result", "rehab-report", "other"]),
  organisation: text,
  kind: text,
  patientName: text,
  patientBirthDate: text,
  sampleTaken: text,
  reported: text,
  validatedBy: text,
  stay: text,
  reason: text,
  writtenBy: text,
  sentBy: text,
  rows: z.array(z.object({ test: text, valueText: text, unitText: text, rangeText: text, loinc: text })),
} satisfies Partial<Record<keyof LabResult | keyof RehabReport | `patient${string}`, z.ZodType>>);

export type ModelReading = z.infer<typeof modelReadingSchema>;

/** Sends the document to a language model and returns its raw answer, which is checked against `modelReadingSchema`. */
export type DocumentReader = (markdown: string) => Promise<{ model: string; output: unknown }>;

// Reasons for the held notice (src/server/matrix/notices.ts). They go into Matrix, so they name no document content.
export const HELD_REASON = "The parser could not read the document, so a language model read it. Check every value before you accept it.";
export const UNVERIFIED_REASON = "A language model read the document, but its reading does not match the document. Check the file itself.";

type Held = { by: "model"; model: string; reason: string };

export type FallbackResult =
  /** The parser read the document or refused it, the wide reader cannot read it, or there is no usable model answer. */
  | ParseResult
  /** Code read the document and the model's reading agrees in every field. Held for Dr. Hofer. */
  | { ok: true; document: ParsedDocument; held: Held }
  /**
   * The model's reading disagrees with the document. Held for Dr. Hofer with the file only. `unverified` quotes the
   * model's values: show it in the widget, never in Matrix or the audit log.
   */
  | { ok: false; errors: string[]; held: Held & { unverified: string[] } };

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const plain = (s: string) => collapse(s.replace(/[*_]/g, "")).toLowerCase();

// Keys and column headers code accepts for each field, in lower case. A field found under two of them with different
// values is ambiguous, and an ambiguous field gives no record.
const FIELD_KEYS: Record<KeyField, Set<string>> = {
  sampleTaken: new Set(["sample taken", "sampled", "sample collected", "collected", "collection date", "date of collection", "specimen collected", "sample date"]),
  reported: new Set(["reported", "report date", "date of report", "reported on", "issued", "date issued", "result date"]),
  validatedBy: new Set(["validated by", "approved by", "released by", "authorised by", "authorized by", "signed by"]),
  stay: new Set(["stay", "period of stay", "dates of stay", "admission period"]),
  reason: new Set(["reason", "reason for stay", "reason for admission", "indication"]),
  writtenBy: new Set(["written by", "author", "authored by", "report by"]),
  sentBy: new Set(["sent by", "sender"]),
};
const CONSUMED = new Set([...IDENTITY_KEYS, "requested by", ...Object.values(FIELD_KEYS).flatMap((s) => [...s])]);
/** A key code reads as a field. `Name:` or `Born:` below the header block is text, as `patient-lines.ts` reads it. */
const consumed = (line: KeyLine) => CONSUMED.has(line.norm) && (line.header || !HEADER_ONLY_KEYS.has(line.norm));
const COLUMNS: Record<LabRowKey, Set<string>> = {
  test: new Set(["test", "analyte", "parameter", "investigation", "examination", "analysis", "test name"]),
  valueText: new Set(["result", "results", "value", "result value", "measured value", "finding"]),
  unitText: new Set(["unit", "units"]),
  rangeText: new Set(["reference range", "range", "normal range", "reference", "reference interval", "ref. range", "ref range", "reference values"]),
  loinc: new Set(["loinc", "loinc code"]),
};
const COLUMN_LABEL: Record<LabRowKey, string> = { test: "test", valueText: "result", unitText: "unit", rangeText: "reference range", loinc: "LOINC" };
const LAB_KINDS = new Set(["lab report", "laboratory report", "lab result", "lab results", "laboratory result", "laboratory results", "lab findings"]);
const REHAB_KINDS = new Set(["discharge report", "discharge letter", "discharge summary", "rehab discharge report", "rehabilitation discharge report"]);
const RANGE = /^(-?\d+(?:[.,]\d+)?)\s*(?:to|-|–|—|−)\s*(-?\d+(?:[.,]\d+)?)$/;

const md = new MarkdownIt();

type Table = { header: string[]; rows: string[][] };
type Wide = { reading: ModelReading; document: ParsedDocument | null; errors: string[]; refusals: { safety: SafetyRefusal; error: string }[] };

/** The document as markdown-it tokens: the heading, key lines, free text, `##` sections, and tables. */
function collect(markdown: string) {
  const out = { title: null as string | null, textBeforeTitle: false, lines: [] as KeyLine[], free: [] as string[], sections: [] as { heading: string; lines: string[] }[], tables: [] as Table[] };
  let section: (typeof out.sections)[number] | null = null;
  let table: Table | null = null;
  let row: string[] | null = null;
  let inHead = false;
  let listDepth = 0;
  const header = headerBlock();
  const addText = (line: string) => (section ? section.lines : out.free).push(line);
  const tokens = md.parse(markdown, {});
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    header.see(t, tokens[i + 1]);
    if (t.type === "bullet_list_open" || t.type === "ordered_list_open") listDepth++;
    else if (t.type === "bullet_list_close" || t.type === "ordered_list_close") listDepth--;
    else if (t.type === "table_open") out.tables.push((table = { header: [], rows: [] }));
    else if (t.type === "table_close") table = null;
    else if (t.type === "thead_open") inHead = true;
    else if (t.type === "thead_close") inHead = false;
    else if (t.type === "tr_open") row = [];
    else if (t.type === "tr_close") {
      if (table && row && inHead) table.header.push(...row);
      else if (table && row) table.rows.push(row);
      row = null;
    } else if (t.type === "inline" && row) row.push(collapse(t.content));
    else if (t.type === "heading_open") {
      const heading = collapse(tokens[i + 1]?.content ?? "");
      if (t.tag === "h1" && out.title === null) {
        out.title = heading;
        out.textBeforeTitle = i > 0;
      }
      // `## Patient` in the header block is part of it, not a section.
      else if (header.open && isPatientHeading(heading)) section = null;
      else if (t.tag === "h2") out.sections.push((section = { heading, lines: [] }));
      // A `###` heading or a second `#` heading stays text, as in the parser.
      else addText(heading);
      i += 2;
    } else if (t.type === "fence" || t.type === "code_block") {
      for (const line of t.content.split("\n").map(collapse).filter(Boolean)) addText(line);
    } else if (t.type === "inline" && tokens[i - 1]?.type === "paragraph_open") {
      for (const line of t.content.split("\n").map(collapse).filter(Boolean)) {
        const kl = listDepth ? null : toKeyLine(line, header.open);
        // As in the parser: inside a `##` section only the keys code knows count as fields.
        if (kl && (!section || consumed(kl))) out.lines.push(kl);
        if (!kl || !consumed(kl)) addText(listDepth ? `- ${line}` : line);
      }
    }
  }
  return out;
}

function labRow(row: ModelReading["rows"][number], n: number, errors: string[]): LabRow | null {
  const where = `Row ${n + 1} (${row.test || "no test name"})`;
  const value = toNumber(row.valueText);
  if (value === null) errors.push(`${where}: the result "${row.valueText}" is not a number.`);
  if (!isLoinc(row.loinc)) errors.push(`${where}: "${row.loinc}" is not a LOINC code such as 6301-6, or its check digit is wrong.`);
  // UCUM and the vital sign checks as in the parser, so a record from the fallback files as valid FHIR too.
  const unit = rowUnit(row.loinc, row.unitText);
  if ("error" in unit) errors.push(`${where}: ${unit.error}`);
  // A range that is written but cannot be read gives no record, so a value outside it can never pass as normal.
  const dashed = row.rangeText ? RANGE.exec(collapse(row.rangeText)) : null;
  const low = dashed ? toNumber(dashed[1]) : null;
  const high = dashed ? toNumber(dashed[2]) : null;
  const range = low !== null && high !== null ? twoSided(low, high) : oneSided(row.rangeText);
  if (row.rangeText && !range) errors.push(`${where}: the reference range "${row.rangeText}" cannot be read.`);
  if (value === null || !isLoinc(row.loinc) || "error" in unit || (row.rangeText && !range)) return null;
  return {
    test: row.test,
    value,
    valueText: row.valueText,
    ucum: unit.ucum,
    unitText: row.unitText,
    rangeText: row.rangeText,
    loinc: row.loinc,
    ...rangeFields(value, range),
  };
}

/**
 * Code's own reading of a format the parser does not know, with synonyms for keys and headers. It returns the record
 * and its reading in the model's schema. Not exported: the only way out is `parseWithFallback()`, which holds it.
 */
function readWide(markdown: string): Wide {
  const source = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const raw = collect(source);
  const errors: string[] = [];

  // Safety refusals first: they never reach the model.
  const refusals: Wide["refusals"] = [];
  if (raw.tables.length > 1) refusals.push({ safety: "several-tables", error: "The file has more than one table. Put all results in one table." });
  const seen = new Map<string, string>();
  const repeated = new Set<string>();
  // Only keys code reads, as in the parser: two `Note:` lines are text, not a second patient.
  for (const { key, norm, value } of raw.lines.filter(consumed)) {
    if (seen.has(norm) && seen.get(norm) !== value) repeated.add(key);
    else seen.set(norm, value);
  }
  for (const key of repeated) refusals.push({ safety: "repeated-key", error: `The file has more than one "${key}:" line.` });
  const identity = patientIdentity(keyLines(source));
  refusals.push(...identity.refusals);

  // The patient, from the line that names them. Code reads the whole name part and the one birth date.
  errors.push(...identity.errors);
  if (!identity.name && !identity.errors.length) errors.push("The file has no line that names the patient.");
  const birthDate = identity.birth?.date ?? null;
  if (!birthDate) errors.push("The file has no readable birth date for the patient.");

  // The type, from the kind in the heading, as the parser does.
  if (!raw.title) errors.push("The file has no heading.");
  // The parser takes the first `#` heading wherever it is. Here, text before it gives no record.
  else if (raw.textBeforeTitle) errors.push("The file has text before its heading.");
  const parts = (raw.title ?? "").split(/\s+[—–-]\s+|\s*[:|]\s*/).map((p) => p.trim()).filter(Boolean);
  const kindAt = parts.findIndex((p) => LAB_KINDS.has(p.toLowerCase()) || REHAB_KINDS.has(p.toLowerCase()));
  const kind = kindAt >= 0 ? parts[kindAt] : (parts[1] ?? "");
  const type = kindAt < 0 ? "other" : LAB_KINDS.has(kind.toLowerCase()) ? "lab-result" : "rehab-report";
  const organisation = parts.length === 2 ? parts[kindAt >= 0 ? 1 - kindAt : 0] : "";
  if (type === "other" && raw.tables.length) errors.push("The file has a table, but its heading names no lab report, so its results cannot be read.");

  // Each key field from its own keys only.
  const field = (f: KeyField) => {
    const values = new Set(raw.lines.filter((l) => FIELD_KEYS[f].has(l.norm)).map((l) => l.value));
    if (values.size > 1) errors.push(`The file has more than one line for ${f}.`);
    return values.size === 1 ? [...values][0] : "";
  };
  const reading: ModelReading = {
    type,
    organisation,
    kind,
    patientName: identity.name ?? "",
    patientBirthDate: identity.birth?.text ?? "",
    ...(Object.fromEntries(KEY_FIELDS.map((f) => [f, field(f)])) as Record<KeyField, string>),
    rows: [],
  };

  // Each lab value from the one column whose header names it.
  if (type === "lab-result") {
    const table = raw.tables.length === 1 ? raw.tables[0] : null;
    if (!table) errors.push("The lab report has no result table.");
    else {
      const header = table.header.map(plain);
      const col = {} as Record<LabRowKey, number>;
      for (const f of LAB_ROW_KEYS) {
        const at = header.flatMap((h, i) => (COLUMNS[f].has(h) ? [i] : []));
        if (at.length === 1) col[f] = at[0];
        else errors.push(`The result table needs exactly one ${COLUMN_LABEL[f]} column.`);
      }
      if (Object.keys(col).length === LAB_ROW_KEYS.length) {
        reading.rows = table.rows.map((cells) => Object.fromEntries(LAB_ROW_KEYS.map((f) => [f, cells[col[f]] ?? ""])) as Record<LabRowKey, string>);
      }
      if (!table.rows.length) errors.push("The result table has no rows.");
    }
  }

  const base = {
    title: raw.title ?? "",
    organisation,
    kind: kind.toLowerCase(),
    patient: { name: identity.name ?? "", birthDate: birthDate ?? "" },
    fields: Object.fromEntries([...raw.lines].reverse().map((l) => [l.key, l.value])),
    markdown,
  };
  const person = (value: string): PersonLine | null => (value ? parsePersonLine(value) : null);
  const dateTime = (label: string, value: string) => {
    const parsed = value ? parseViennaDateTimeWide(value) : null;
    if (!parsed) errors.push(value ? `"${label}: ${value}" is not a date such as "22.10.2026 08:10".` : `The file has no "${label}:" line.`);
    return parsed ?? "";
  };

  let document: ParsedDocument;
  if (type === "lab-result") {
    document = {
      ...base,
      type,
      sampleTaken: dateTime("Sample taken", reading.sampleTaken),
      reported: dateTime("Reported", reading.reported),
      rows: reading.rows.flatMap((r, n) => labRow(r, n, errors) ?? []),
      // All free text, as in the parser: lines outside sections, sub-headings, code blocks, and each `##` section.
      conclusion: freeText(raw.free, raw.sections),
      validatedBy: person(reading.validatedBy),
    };
  } else if (type === "rehab-report") {
    const stay = parseStayWide(reading.stay);
    if (!stay) errors.push(reading.stay ? `"Stay: ${reading.stay}" is not a stay such as "02.09.2026 - 23.09.2026".` : 'The file has no "Stay:" line.');
    document = {
      ...base,
      type,
      stay: stay ?? { start: "", end: "" },
      reason: reading.reason || null,
      sections: raw.sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n") })),
      writtenBy: person(reading.writtenBy),
      sentBy: person(reading.sentBy),
    };
  } else {
    document = { ...base, type: "other" };
  }
  return { reading, document: errors.length ? null : document, errors, refusals };
}

/** Every field where the model's reading differs from code's, for example `rows[1].valueText: "31"`. Empty means they agree. */
function disagreements(model: ModelReading, code: ModelReading): string[] {
  const out: string[] = [];
  const check = (path: string, m: string, c: string, same = collapse(m) === collapse(c)) => {
    if (!same) out.push(`${path}: ${JSON.stringify(m)}`);
  };
  check("type", model.type, code.type);
  check("organisation", model.organisation, code.organisation);
  check("kind", model.kind, code.kind, collapse(model.kind).toLowerCase() === collapse(code.kind).toLowerCase());
  check("patientName", model.patientName, code.patientName);
  const birth = parseDateWide(collapse(model.patientBirthDate));
  check("patientBirthDate", model.patientBirthDate, code.patientBirthDate, birth !== null && birth === parseDateWide(code.patientBirthDate));
  for (const f of KEY_FIELDS) check(f, model[f], code[f]);
  if (model.rows.length !== code.rows.length) out.push(`rows: ${model.rows.length} rows, but the table has ${code.rows.length}`);
  else model.rows.forEach((row, i) => LAB_ROW_KEYS.forEach((f) => check(`rows[${i}].${f}`, row[f], code.rows[i][f])));
  return out;
}

/**
 * `parseDocument()`, and when it fails for its format and a reader is configured, the AI fallback. A safety refusal
 * never reaches the model, and neither does a file code cannot read. A model failure or an answer that does not fit the
 * schema leaves the parser's result as it was. Anything the fallback reads comes back with `held`.
 */
export async function parseWithFallback(markdown: string, reader: DocumentReader | null): Promise<FallbackResult> {
  const parsed = parseDocument(markdown);
  if (parsed.ok || !reader || parsed.safety.length) return parsed;
  const wide = readWide(markdown);
  if (wide.refusals.length) {
    return { ok: false, errors: [...parsed.errors, ...wide.refusals.map((r) => r.error)], safety: [...new Set(wide.refusals.map((r) => r.safety))] };
  }
  if (!wide.document) return { ok: false, errors: [...parsed.errors, ...wide.errors], safety: [] };

  let answer: { model: string; output: unknown };
  try {
    answer = await reader(markdown);
  } catch {
    return parsed;
  }
  const reading = modelReadingSchema.safeParse(answer.output);
  if (!reading.success) return parsed;

  const unverified = disagreements(reading.data, wide.reading);
  const held = { by: "model" as const, model: answer.model };
  return unverified.length
    ? { ok: false, errors: parsed.errors, held: { ...held, reason: UNVERIFIED_REASON, unverified } }
    : { ok: true, document: wide.document, held: { ...held, reason: HELD_REASON } };
}
