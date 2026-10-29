import MarkdownIt, { type Token } from "markdown-it";

import { parseDate, parseDateRange, parseDateTime } from "./dates";
import type { DocumentPerson, LabResultRow, ParseResult, ParsedDocument } from "./types";

// Reads the scenario's Markdown format. docs/ARCHITECTURE.md, "Document parsing".
const md = new MarkdownIt();
const KEY_VALUE = /^([A-Z][a-z]*(?: [a-z]+)*): (.+)$/;
const LAB_COLUMNS = { test: "test", result: "result", unit: "unit", range: "reference range", loinc: "loinc code" } as const;

class ParseError extends Error {}

function need<T>(value: T | null | undefined, reason: string): T {
  if (value == null || value === "") throw new ParseError(reason);
  return value;
}

const toNumber = (value: string) => (/^-?\d+(?:[.,]\d+)?$/.test(value) ? Number(value.replace(",", ".")) : null);

function person(value: string): DocumentPerson {
  const [name, role, ...org] = value.split(", ").map((part) => part.trim());
  return { name, ...(role ? { role } : {}), ...(org.length ? { org: org.join(", ") } : {}) };
}

function tableRows(tokens: Token[], start: number): string[][] {
  const rows: string[][] = [];
  for (let i = start; tokens[i].type !== "table_close"; i++) {
    if (tokens[i].type === "tr_open") rows.push([]);
    if (tokens[i].type === "inline") rows.at(-1)?.push(tokens[i].content.trim());
  }
  return rows;
}

function labRows(table: string[][]): LabResultRow[] {
  const [header = [], ...body] = table;
  const names = header.map((cell) => cell.toLowerCase());
  const indexOf = (name: string) => {
    const index = names.indexOf(name);
    if (index < 0) throw new ParseError(`The table has no column "${name}".`);
    return index;
  };
  const column = {
    test: indexOf(LAB_COLUMNS.test),
    result: indexOf(LAB_COLUMNS.result),
    unit: indexOf(LAB_COLUMNS.unit),
    range: indexOf(LAB_COLUMNS.range),
    loinc: indexOf(LAB_COLUMNS.loinc),
  };

  return need(body.length ? body : null, "The table has no rows.").map((cells) => {
    const test = need(cells[column.test], "A table row has no test name.");
    const value = need(toNumber(cells[column.result] ?? ""), `The result of "${test}" is not a number.`);
    const loinc = need(/^\d{1,7}-\d$/.exec(cells[column.loinc] ?? "")?.[0], `The LOINC code of "${test}" is missing or invalid.`);
    const row: LabResultRow = { test, loinc, value };
    const unit = cells[column.unit]?.replace(/\^/g, "*");
    if (unit) row.unit = unit;
    const text = cells[column.range];
    if (text) {
      const bounds = /^(\S+) to (\S+)$/.exec(text);
      const [low, high] = bounds ? [toNumber(bounds[1]), toNumber(bounds[2])] : [null, null];
      row.range = low != null && high != null ? { low, high, text } : { text };
    }
    return row;
  });
}

function read(markdown: string): ParsedDocument {
  const tokens = md.parse(markdown, {});
  const lines = markdown.split(/\r?\n/);
  const fields: Record<string, string> = {};
  const sections: { heading: string; parts: string[] }[] = [];
  const loose: string[] = [];
  const tables: string[][][] = [];
  let title: string | undefined;

  tokens.forEach((token, i) => {
    if (token.level !== 0 || token.nesting === -1) return;
    const parts = sections.at(-1)?.parts ?? loose;
    if (token.type === "heading_open") {
      const text = tokens[i + 1].content.trim();
      if (token.tag === "h1" && title === undefined) title = text;
      else sections.push({ heading: text, parts: [] });
    } else if (token.type === "paragraph_open") {
      const free: string[] = [];
      for (const line of tokens[i + 1].content.split("\n")) {
        const match = KEY_VALUE.exec(line.trim());
        if (!match) free.push(line.trim());
        else if (Object.hasOwn(fields, match[1])) throw new ParseError(`The document has more than one "${match[1]}" line.`);
        else fields[match[1]] = match[2].trim();
      }
      if (free.length) parts.push(free.join("\n"));
    } else {
      if (token.type === "table_open") tables.push(tableRows(tokens, i));
      if (token.map && (token.type !== "table_open" || sections.length)) parts.push(lines.slice(...token.map).join("\n").trim());
    }
  });

  const heading = need(title, "The document has no heading such as `# Labor Kanalstraße: lab report`.");
  const [org, kind] = heading.split(/: (.*)/s);
  need(kind, "The heading does not name the organisation and the document kind.");
  const [patientName, born] = need(fields.Patient, 'The document has no "Patient" line.').split(", born ");
  const base = {
    title: heading,
    org: org.trim(),
    kind: kind.trim().toLowerCase(),
    patient: {
      name: need(patientName?.trim(), "The patient line has no name."),
      birthDate: need(parseDate(born ?? ""), "The patient line has no readable birth date."),
    },
    fields,
    sections: sections.map(({ heading, parts }) => ({ heading, text: parts.join("\n\n") })),
    markdown,
  };

  if (base.kind === "lab report") {
    return {
      ...base,
      type: "lab-result",
      sampleTaken: need(parseDateTime(fields["Sample taken"] ?? ""), 'The "Sample taken" line is missing or unreadable.'),
      reported: need(parseDateTime(fields.Reported ?? ""), 'The "Reported" line is missing or unreadable.'),
      rows: labRows(need(tables.length === 1 ? tables[0] : null, "A lab report needs exactly one results table.")),
      ...(loose.length ? { conclusion: loose.join("\n\n") } : {}),
      validatedBy: person(need(fields["Validated by"], 'The document has no "Validated by" line.')),
    };
  }
  if (base.kind === "discharge report") {
    return {
      ...base,
      type: "rehab-report",
      stay: need(parseDateRange(fields.Stay ?? ""), 'The "Stay" line is missing or unreadable.'),
      ...(fields.Reason ? { reason: fields.Reason } : {}),
      writtenBy: person(need(fields["Written by"], 'The document has no "Written by" line.')),
      ...(fields["Sent by"] ? { sentBy: person(fields["Sent by"]) } : {}),
    };
  }
  return { ...base, type: "generic" };
}

/** Parses an answer. A document the parser cannot read comes back with the reason, never half read. */
export function parseDocument(markdown: string): ParseResult {
  try {
    return { ok: true, document: read(markdown) };
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, reason: error.message };
    throw error;
  }
}
