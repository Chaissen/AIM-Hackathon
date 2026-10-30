import MarkdownIt from "markdown-it";

import { TITLE } from "@/server/identity/names";
import { parseDate, parseStay, parseViennaDateTime } from "./dates";
import { keyLines, patientIdentity } from "./patient-lines";
import type { LabRow, ParseResult, ParsedDocument, PersonLine, SafetyRefusal } from "./types";

// Reads the scenario Markdown format into typed records (docs/ARCHITECTURE.md, "Document parsing").

const md = new MarkdownIt();
type Token = ReturnType<typeof md.parse>[number];

/** Keys from the docs. Inside `##` sections only these count as fields, so a sentence with a colon stays text. */
const KNOWN_KEYS = new Set(["Patient", "Requested by", "Sample taken", "Reported", "Stay", "Reason", "Validated by", "Written by", "Sent by"]);
const KEY_LINE = /^([A-Z][A-Za-z ]{0,40}): (.+)$/;
const LAB_COLUMNS = ["Test", "Result", "Unit", "Reference range", "LOINC code"] as const;

type Table = { header: string[]; rows: string[][] };

type Raw = {
  title: string | null;
  fields: Record<string, string>;
  /** Known keys that appear on more than one line with different values. */
  duplicates: Set<string>;
  tables: Table[];
  free: string[];
  sections: { heading: string; lines: string[] }[];
};

/** One pass over the markdown-it tokens: heading, key lines, tables, free text, and `##` sections. */
function collect(markdown: string): Raw {
  const raw: Raw = { title: null, fields: {}, duplicates: new Set(), tables: [], free: [], sections: [] };
  const tokens = md.parse(markdown, {});
  let section: Raw["sections"][number] | null = null;
  let listDepth = 0;

  const addText = (line: string) => (section ? section.lines.push(line) : raw.free.push(line));

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "bullet_list_open" || t.type === "ordered_list_open") listDepth++;
    else if (t.type === "bullet_list_close" || t.type === "ordered_list_close") listDepth--;
    else if (t.type === "heading_open") {
      const text = tokens[i + 1]?.content.trim() ?? "";
      if (t.tag === "h1" && raw.title === null) raw.title = text;
      else if (t.tag === "h2") raw.sections.push((section = { heading: text, lines: [] }));
      // A `###` heading or a second `#` heading stays text, so a comment under it reaches the conclusion.
      else if (text) addText(text);
      i += 2;
    } else if (t.type === "fence" || t.type === "code_block") {
      for (const line of t.content.split("\n").map((l) => l.trim()).filter(Boolean)) addText(line);
    } else if (t.type === "table_open") {
      const { table, end } = readTable(tokens, i);
      raw.tables.push(table);
      i = end;
    } else if (t.type === "inline" && tokens[i - 1]?.type === "paragraph_open") {
      // Every paragraph of a list item is list text, not only the first one.
      const inList = listDepth > 0;
      for (const line of t.content.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const m = line.match(KEY_LINE);
        // Split at the first ": " (docs). In a section only the known keys count.
        if (!inList && m && (!section || KNOWN_KEYS.has(m[1]))) {
          const key = m[1];
          const value = m[2].trim();
          // A second `Patient:` line could carry another patient past the patient check, so a known key may repeat only with
          // the same value. An unknown key keeps its first value; every line of it is in the free text below anyway.
          if (!Object.hasOwn(raw.fields, key)) raw.fields[key] = value;
          else if (raw.fields[key] !== value && KNOWN_KEYS.has(key)) raw.duplicates.add(key);
          // An unknown key such as `Note:` is also free text, so the comment reaches the conclusion.
          if (!KNOWN_KEYS.has(key)) addText(line);
        } else addText(inList ? `- ${line}` : line);
      }
    }
  }
  return raw;
}

function readTable(tokens: Token[], start: number): { table: Table; end: number } {
  const header: string[] = [];
  const rows: string[][] = [];
  let row: string[] | null = null;
  let inHead = false;
  let i = start;
  for (; i < tokens.length && tokens[i].type !== "table_close"; i++) {
    const t = tokens[i];
    if (t.type === "thead_open") inHead = true;
    else if (t.type === "thead_close") inHead = false;
    else if (t.type === "tr_open") row = [];
    else if (t.type === "tr_close" && row) {
      if (inHead) header.push(...row);
      else rows.push(row);
      row = null;
    } else if (t.type === "inline" && row) row.push(t.content.trim());
  }
  return { table: { header, rows }, end: i };
}

/** The conclusion of a lab report: every free line, then each `##` section as `Heading: text`. Null when there is none. */
export function freeText(free: string[], sections: { heading: string; lines: string[] }[]): string | null {
  const parts = [...free, ...sections.map((s) => (s.lines.length ? `${s.heading}: ${s.lines.join(" ")}` : s.heading))];
  return parts.join(" ") || null;
}

/** `Dr. Eva Brandl, lab physician` into titles, given, family, and details. */
export function parsePersonLine(raw: string): PersonLine | null {
  const [namePart, ...details] = raw.split(",").map((s) => s.trim());
  const words = namePart.split(/\s+/).filter(Boolean);
  const titles: string[] = [];
  while (words.length > 1 && TITLE.test(words[0])) titles.push(words.shift()!);
  const family = words.pop();
  if (!family) return null;
  return { raw, titles, given: words.join(" "), family, details: details.filter(Boolean) };
}

/** `3.1`, `3,1`, or `0,125`. Null for `1,245`, which may mean 1245 with a thousands separator or 1.245. */
export function toNumber(text: string): number | null {
  const t = text.trim();
  if (/^-?[1-9]\d{0,2}(?:,\d{3})+$/.test(t) || !/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  return Number(t.replace(",", "."));
}

/** A LOINC code such as `6301-6`, with the mod-10 check digit after the dash (Luhn over the digits before it). */
export function isLoinc(code: string): boolean {
  const m = /^(\d{1,7})-(\d)$/.exec(code);
  if (!m) return false;
  const sum = [...m[1]].reverse().reduce((acc, c, i) => {
    const d = Number(c) * (i % 2 === 0 ? 2 : 1);
    return acc + (d > 9 ? d - 9 : d);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(m[2]);
}

function labRows(table: Table, errors: string[]): LabRow[] {
  const col = Object.fromEntries(LAB_COLUMNS.map((c) => [c, table.header.indexOf(c)])) as Record<(typeof LAB_COLUMNS)[number], number>;
  const missing = LAB_COLUMNS.filter((c) => col[c] < 0);
  if (missing.length) {
    errors.push(`The result table has no column ${missing.map((c) => `"${c}"`).join(", ")}.`);
    return [];
  }
  return table.rows.flatMap((cells, n) => {
    const cell = (c: (typeof LAB_COLUMNS)[number]) => cells[col[c]] ?? "";
    const test = cell("Test");
    const value = toNumber(cell("Result"));
    if (value === null) {
      errors.push(`Row ${n + 1} (${test || "no test name"}): the result "${cell("Result")}" is not a number.`);
      return [];
    }
    if (!isLoinc(cell("LOINC code"))) {
      errors.push(`Row ${n + 1} (${test}): "${cell("LOINC code")}" is not a LOINC code such as 6301-6, or its check digit is wrong.`);
      return [];
    }
    const [lowText, highText, ...extra] = cell("Reference range").split(" to ");
    const low = extra.length ? null : toNumber(lowText ?? "");
    const high = extra.length ? null : toNumber(highText ?? "");
    const hasRange = low !== null && high !== null;
    const unitText = cell("Unit");
    return [
      {
        test,
        value,
        valueText: cell("Result"),
        // UCUM writes powers with "*": "10^9/L" becomes "10*9/L" (docs/FHIR.md, validator traps).
        ucum: unitText ? unitText.replace(/\^/g, "*") : null,
        unitText,
        low: hasRange ? low : null,
        high: hasRange ? high : null,
        rangeText: cell("Reference range"),
        loinc: cell("LOINC code"),
        interpretation: hasRange ? (value < low ? "L" : value > high ? "H" : "N") : null,
      },
    ];
  });
}

/**
 * Reads one uploaded document. `lab report` becomes a LabResult, `discharge report` a RehabReport,
 * any other kind a GenericDocument. Never throws on content; problems come back in `errors`.
 */
export function parseDocument(markdown: string): ParseResult {
  // A byte order mark (Windows editors) would hide the `#` of the heading from markdown-it.
  const raw = collect(markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
  const errors: string[] = [];
  const safety = new Set<SafetyRefusal>();

  const colon = raw.title?.indexOf(":") ?? -1;
  if (!raw.title || colon <= 0) errors.push('The file has no heading such as "# Labor Kanalstraße: lab report".');
  const organisation = raw.title && colon > 0 ? raw.title.slice(0, colon).trim() : "";
  const kind = raw.title && colon > 0 ? raw.title.slice(colon + 1).trim().toLowerCase() : "";

  const patientLine = raw.fields["Patient"];
  const [patientName, born] = patientLine?.split(", born ") ?? [];
  const birthDate = born ? parseDate(born) : null;
  if (!patientLine) errors.push('The file has no line such as "Patient: Maria Beispiel, born 12 March 1961".');
  else if (!patientName?.trim() || !birthDate) errors.push(`The patient line "${patientLine}" needs a name and a birth date such as "born 12 March 1961".`);
  for (const key of raw.duplicates) {
    errors.push(`The file has more than one "${key}:" line.`);
    safety.add("repeated-key");
  }
  // Lines this parser does not read as fields, such as `**Patient:** Max` or `Name: Max`, must not name another patient.
  for (const refusal of patientIdentity(keyLines(markdown)).refusals) {
    errors.push(refusal.error);
    safety.add(refusal.safety);
  }

  const base = {
    title: raw.title ?? "",
    organisation,
    kind,
    patient: { name: patientName?.trim() ?? "", birthDate: birthDate ?? "" },
    fields: raw.fields,
    markdown,
  };
  const person = (key: string) => (raw.fields[key] ? parsePersonLine(raw.fields[key]) : null);
  const dateTime = (key: string) => {
    const value = raw.fields[key];
    const parsed = value ? parseViennaDateTime(value) : null;
    if (!parsed) errors.push(value ? `"${key}: ${value}" is not a date such as "22 October 2026, 08:10".` : `The file has no "${key}:" line.`);
    return parsed ?? "";
  };

  let document: ParsedDocument;
  if (kind === "lab report") {
    const sampleTaken = dateTime("Sample taken");
    const reported = dateTime("Reported");
    // A second table would be values the mappers never file, so the results must be in exactly one.
    const table = raw.tables.length === 1 ? raw.tables[0] : null;
    if (!raw.tables.length) errors.push("The lab report has no result table.");
    else if (!table) {
      errors.push("The lab report has more than one table. Put all results in one table.");
      safety.add("several-tables");
    }
    const rows = table ? labRows(table, errors) : [];
    if (table && !table.rows.length) errors.push("The result table has no rows.");
    document = {
      ...base,
      type: "lab-result",
      sampleTaken,
      reported,
      rows,
      conclusion: freeText(raw.free, raw.sections),
      validatedBy: person("Validated by"),
    };
  } else if (kind === "discharge report") {
    const stayText = raw.fields["Stay"];
    const stay = stayText ? parseStay(stayText) : null;
    if (!stay) errors.push(stayText ? `"Stay: ${stayText}" is not a stay such as "2 to 23 September 2026".` : 'The file has no "Stay:" line.');
    document = {
      ...base,
      type: "rehab-report",
      stay: stay ?? { start: "", end: "" },
      reason: raw.fields["Reason"] ?? null,
      sections: raw.sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n") })),
      writtenBy: person("Written by"),
      sentBy: person("Sent by"),
    };
  } else {
    document = { ...base, type: "other" };
  }

  return errors.length ? { ok: false, errors, safety: [...safety] } : { ok: true, document };
}
