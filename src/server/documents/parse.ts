import MarkdownIt from "markdown-it";

import { parseDate, parseStay, parseViennaDateTime } from "./dates";
import type { LabRow, ParseResult, ParsedDocument, PersonLine } from "./types";

// Reads the scenario Markdown format into typed records (docs/ARCHITECTURE.md, "Document parsing").

const md = new MarkdownIt();
type Token = ReturnType<typeof md.parse>[number];

/** Keys from the docs. Inside `##` sections only these count as fields, so a sentence with a colon stays text. */
const KNOWN_KEYS = new Set(["Patient", "Requested by", "Sample taken", "Reported", "Stay", "Reason", "Validated by", "Written by", "Sent by"]);
const KEY_LINE = /^([A-Z][A-Za-z ]{0,40}): (.+)$/;
const LAB_COLUMNS = ["Test", "Result", "Unit", "Reference range", "LOINC code"] as const;
const TITLE_WORD = /^(dr|mag|prof|univ|med|di|ing|dipl)\.?(-\w+\.?)*$/i;

type Raw = {
  title: string | null;
  fields: Record<string, string>;
  table: { header: string[]; rows: string[][] } | null;
  free: string[];
  sections: { heading: string; lines: string[] }[];
};

/** One pass over the markdown-it tokens: heading, key lines, the first table, free text, and `##` sections. */
function collect(markdown: string): Raw {
  const raw: Raw = { title: null, fields: {}, table: null, free: [], sections: [] };
  const tokens = md.parse(markdown, {});
  let section: Raw["sections"][number] | null = null;

  const addText = (line: string) => (section ? section.lines.push(line) : raw.free.push(line));

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "heading_open") {
      const text = tokens[i + 1]?.content.trim() ?? "";
      if (t.tag === "h1" && raw.title === null) raw.title = text;
      else if (t.tag === "h2") raw.sections.push((section = { heading: text, lines: [] }));
      i += 2;
    } else if (t.type === "table_open") {
      const { table, end } = readTable(tokens, i);
      raw.table ??= table;
      i = end;
    } else if (t.type === "inline" && tokens[i - 1]?.type === "paragraph_open") {
      const inList = tokens[i - 2]?.type === "list_item_open";
      for (const line of t.content.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const m = line.match(KEY_LINE);
        // Split at the first ": " (docs). In a section only the known keys count.
        if (!inList && m && (!section || KNOWN_KEYS.has(m[1]))) raw.fields[m[1]] = m[2].trim();
        else addText(inList ? `- ${line}` : line);
      }
    }
  }
  return raw;
}

function readTable(tokens: Token[], start: number): { table: Raw["table"]; end: number } {
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

/** `Dr. Eva Brandl, lab physician` into titles, given, family, and details. */
export function parsePersonLine(raw: string): PersonLine | null {
  const [namePart, ...details] = raw.split(",").map((s) => s.trim());
  const words = namePart.split(/\s+/).filter(Boolean);
  const titles: string[] = [];
  while (words.length > 1 && TITLE_WORD.test(words[0])) titles.push(words.shift()!);
  const family = words.pop();
  if (!family) return null;
  return { raw, titles, given: words.join(" "), family, details: details.filter(Boolean) };
}

export const toNumber = (text: string) => (/^-?\d+(?:[.,]\d+)?$/.test(text.trim()) ? Number(text.trim().replace(",", ".")) : null);

function labRows(table: NonNullable<Raw["table"]>, errors: string[]): LabRow[] {
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
    if (!/^\d{1,7}-\d$/.test(cell("LOINC code"))) {
      errors.push(`Row ${n + 1} (${test}): "${cell("LOINC code")}" is not a LOINC code such as 6301-6.`);
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
  const raw = collect(markdown.replace(/\r\n?/g, "\n"));
  const errors: string[] = [];

  const colon = raw.title?.indexOf(":") ?? -1;
  if (!raw.title || colon <= 0) errors.push('The file has no heading such as "# Labor Kanalstraße: lab report".');
  const organisation = raw.title && colon > 0 ? raw.title.slice(0, colon).trim() : "";
  const kind = raw.title && colon > 0 ? raw.title.slice(colon + 1).trim().toLowerCase() : "";

  const patientLine = raw.fields["Patient"];
  const [patientName, born] = patientLine?.split(", born ") ?? [];
  const birthDate = born ? parseDate(born) : null;
  if (!patientLine) errors.push('The file has no line such as "Patient: Maria Beispiel, born 12 March 1961".');
  else if (!patientName?.trim() || !birthDate) errors.push(`The patient line "${patientLine}" needs a name and a birth date such as "born 12 March 1961".`);

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
    if (!raw.table) errors.push("The lab report has no result table.");
    const rows = raw.table ? labRows(raw.table, errors) : [];
    if (raw.table && !rows.length && !errors.length) errors.push("The result table has no rows.");
    document = {
      ...base,
      type: "lab-result",
      sampleTaken,
      reported,
      rows,
      conclusion: raw.free.join(" ") || null,
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

  return errors.length ? { ok: false, errors } : { ok: true, document };
}
