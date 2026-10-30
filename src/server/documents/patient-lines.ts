import MarkdownIt from "markdown-it";

import { parseDateWide } from "./dates";
import type { IsoDate, SafetyRefusal } from "./types";

// Finds every line that names the patient or gives the patient's birth date, wherever it is written: plain text,
// a heading, bold, a list, a link, a code block, HTML, a key/value table row, or a key with its value on the next line.
// The parser and the AI fallback both refuse a file in which these lines disagree, so a second patient cannot hide in a
// form either of them does not read (docs/ARCHITECTURE.md).

/**
 * A `key: value` line with its markup stripped. `norm` is the key in lower case, without `(2)` and a final `.`.
 * `header` is true inside the header block (`headerBlock()`).
 */
export type KeyLine = { key: string; norm: string; value: string; header: boolean };

/** Keys that name the patient anywhere in the file. */
const PATIENT_KEYS = new Set(["patient", "patient name", "patient's name", "name of patient", "name of the patient", "patient full name"]);
/** Keys that name the patient only in the header block. Further down, `Name:` is usually a contact or a company. */
const HEADER_PATIENT_KEYS = new Set(["name", "full name"]);
/** Keys for the patient's own birth date anywhere. `Mother's date of birth` is not one of them. */
const BIRTH_KEYS = new Set(["date of birth", "birth date", "birthdate", "dob", "d.o.b", "patient's date of birth", "patient date of birth", "patient's birth date", "patient birth date"]);
/** `Born:` gives the birth date only in the header block. In a `## History` section it is a sentence. */
const HEADER_BIRTH_KEYS = new Set(["born"]);
/** A name in two lines, in the header block. */
const FIRST_KEYS = new Set(["first name", "first names", "given name", "given names", "forename"]);
const LAST_KEYS = new Set(["surname", "family name", "last name"]);

/** Every key that identifies the patient somewhere. The fallback reads none of them as an ordinary field. */
export const IDENTITY_KEYS = new Set([...PATIENT_KEYS, ...HEADER_PATIENT_KEYS, ...BIRTH_KEYS, ...HEADER_BIRTH_KEYS, ...FIRST_KEYS, ...LAST_KEYS]);
/** Identity keys that count only in the header block. */
export const HEADER_ONLY_KEYS = new Set([...HEADER_PATIENT_KEYS, ...HEADER_BIRTH_KEYS, ...FIRST_KEYS, ...LAST_KEYS]);

// HTML on, so an HTML block comes back as one token that we read as text, not as escaped text.
const md = new MarkdownIt({ html: true });

/** A `##` heading that opens the patient's details, such as `## Patient` or `## Patient details`. */
const PATIENT_HEADING = /^(patient|patient data|patient details|patient information|patient's details)$/;
export const isPatientHeading = (text: string) => PATIENT_HEADING.test(text.replace(/[*_#:]/g, "").replace(/\s+/g, " ").trim().toLowerCase());

/**
 * The header block, the same rule in every reader: from the start of the file up to the first table, or up to the
 * first heading after the `#` title that does not open the patient's details. Headings before the title do not end it,
 * so a `Name:` line after the title still counts. Feed it every token in order and read `open` after each.
 */
export function headerBlock() {
  let seenTitle = false;
  let open = true;
  return {
    see(token: { type: string; tag: string }, next?: { content: string }) {
      if (token.type === "table_open") open = false;
      else if (token.type === "heading_open") {
        if (!seenTitle && token.tag === "h1") seenTitle = true;
        else if (seenTitle && !isPatientHeading(next?.content ?? "")) open = false;
      }
    },
    get open() {
      return open;
    },
  };
}
const KEY = /^[A-Za-z][A-Za-z' .-]*(?:\s*\([^)]*\))?$/;

function keyValue(keyPart: string, valuePart: string, header: boolean): KeyLine | null {
  const key = keyPart
    .replace(/^(?:[\s#>*_+-]|\d+[.)]\s)+/, "")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const value = valuePart.replace(/^[\s*_]+|[\s*_]+$/g, "").replace(/\s+/g, " ");
  if (!value || key.length > 50 || !KEY.test(key)) return null;
  const norm = key.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  return { key, norm, value, header };
}

/** Link text instead of the link, no HTML tags, straight apostrophes, ASCII colons, and no `\` hard break at the end. */
const unmark = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[’‘ʼ´`]/g, "'")
    .replace(/[：﹕]/g, ":")
    .replace(/\\\s*$/, "")
    .trim();

/**
 * A value that starts with a date: `12.03.1961`, `1961-03-12`, `12 March 1961`, `12th March 1961`, or `March 12, 1961`,
 * also an impossible date such as `31.02.1961`, and anything after it, such as `12.03.1961 (64 y)`.
 */
const DATE_START = /^(?:\d{1,4}[./-] ?\d{1,2}[./-] ?\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\.? \p{L}{3,}\.? \d{4}|\p{L}{3,}\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4})(?![\p{L}\d])/iu;
const NAME_WORD = /^\p{L}[\p{L}'.-]*$/u;
/** Words a name never has. */
const PROSE_WORDS = new Set(["a", "an", "the", "is", "was", "were", "are", "has", "had", "have", "for", "with", "after", "before", "on", "in", "at", "to", "from", "of", "and", "or"]);
/** A sentence: a verb, or a final `.` after a word of four letters or more, in a value of four words or more. */
const isSentence = (value: string) =>
  /\b(?:is|was|were|are|has|had|have|been|admitted|discharged|presented|reports|reported|underwent|walks|lives)\b/i.test(value) ||
  (value.split(/\s+/).length >= 4 && /\p{L}{4,}[.!?]$/u.test(value));

/**
 * The value reads as a value for this identity key, not as a sentence or another key. For a birth date key it starts
 * with a date. For a name key the part before the first `,`, `(`, `;`, ` - `, or birth clause is one to six words of
 * letters, in any case, with a suffix such as `Jr.`, and not prose. `patientIdentity()` then reads the whole value as on
 * one line: `Beispiel, Max` is unreadable and `Max Beispiel (01.01.1960)` another name. Only a value from the next line
 * must pass, so `Patient:` above `72-year-old woman after a total hip replacement on the left.` names no one.
 */
function plausibleValue(norm: string, value: string): boolean {
  if (IDENTITY_KEYS.has(value.toLowerCase().replace(/[*_:]/g, "").trim())) return false;
  if (BIRTH_KEYS.has(norm) || HEADER_BIRTH_KEYS.has(norm)) return DATE_START.test(value);
  const name = value.split(/[,(;]|\s[-–—]\s|\s(?:born|dob|d\.o\.b\.?|date of birth)(?![a-z])/i)[0].trim();
  const words = name.split(/\s+/);
  const last = words[words.length - 1];
  return (
    !isSentence(value) &&
    words.length <= 6 &&
    words.every((w) => NAME_WORD.test(w) && !PROSE_WORDS.has(w.toLowerCase())) &&
    (!last.endsWith(".") || last.length <= 3)
  );
}

/** `12.03.1961 (64 y)` as 12 March 1961, unless more follows that may be a second date. */
function leadingDate(text: string): IsoDate | null {
  const m = DATE_START.exec(text);
  return m && !/\d{1,4}[./-]\d|\d{4}/.test(text.slice(m[0].length)) ? parseDateWide(m[0]) : null;
}

/**
 * `**Patient name:** Max`, `Patient’s name: Max`, `- Patient:Max`, `Patient： Max`, `[Patient: Max](#)`, or
 * `<b>Name</b>: Max` as a key line, or null. `Patient - Max` counts too, but only for keys that identify the patient.
 */
export function toKeyLine(line: string, header = true): KeyLine | null {
  const clean = unmark(line);
  const colon = clean.indexOf(":");
  const byColon = colon > 0 ? keyValue(clean.slice(0, colon), clean.slice(colon + 1), header) : null;
  if (byColon) return byColon;
  const dash = clean.match(/^(.{1,50}?)\s+[-–—]\s+(.+)$/);
  const byDash = dash ? keyValue(dash[1], dash[2], header) : null;
  return byDash && IDENTITY_KEYS.has(byDash.norm) ? byDash : null;
}

/**
 * `Patient:`, `**Date of birth:**`, `## Patient name:`, or `Patient -` with nothing after the separator: a key that
 * identifies the patient, with its value on the next line. Other keys are not read this way.
 */
export function isBareIdentityKey(line: string): boolean {
  const m = unmark(line)
    .replace(/[\s*_]+$/, "")
    .match(/^(.+?)(?::|\s[-–—])$/);
  const kl = m ? keyValue(m[1], "-", true) : null;
  return kl !== null && IDENTITY_KEYS.has(kl.norm);
}

/** `Max Beispiel DOB` as the key of `Max Beispiel DOB: 01.01.1960`: a name with a birth clause, not a key. */
const ENDS_IN_BIRTH_KEY = /\s(?:born|dob|d\.o\.b|date of birth)$/;

/** Column names that are no value for an identity key, so `| Patient | Ward |` is a header row, not a patient line. */
const COLUMN_NAMES = new Set(["ward", "room", "bed", "age", "sex", "gender", "phone", "telephone", "address", "email", "department", "station", "case number", "insurance number", "admission", "discharge", "diagnosis", "physician", "doctor", "notes", "status"]);

/**
 * The rows of a two-column table as key lines. A lab result table has more columns, and the first column of a
 * two-column one names tests, never the patient. The second header cell decides the layout:
 * - Columns, when it is a column name: an identity key or a word such as `Ward` or `Age`, as in `| Patient | Ward |`
 *   or `| Date of birth | Age |`. Each data row gives each column's key with its cell.
 * - Key/value otherwise, such as `| Patient | Max Beispiel |`, `| Patient | Beispiel, Maria |`, or `| Ward | 3 |`:
 *   every row whose first cell is a key, the header row too, read as the same line would be.
 */
export function keyValueRows(rows: string[][], header: boolean): KeyLine[] {
  if (!rows.length || rows.some((cells) => cells.length !== 2)) return [];
  const cells = rows.map((r) => r.map((c) => unmark(c)));
  const keyCell = (cell: string) => cell.replace(/[\s*_]*:[\s*_]*$/, "");
  const [k0, k1] = cells[0].map((c) => keyValue(keyCell(c), "-", header));
  const columns = k1 !== null && (IDENTITY_KEYS.has(k1.norm) || COLUMN_NAMES.has(k1.norm));
  if (columns) return cells.slice(1).flatMap((row) => [k0, k1].flatMap((k, j) => (k && keyValue(k.key, row[j], header)) || []));
  return cells.flatMap(([key, value]) => keyValue(keyCell(key), value, header) ?? []);
}

/**
 * Every key line: paragraphs, headings, list items, code blocks, HTML blocks, and the rows of two-column tables.
 * A key that identifies the patient alone on its line takes the next line as its value, in the same block or as the
 * first line of the next paragraph or HTML block, but only a value that reads as one (`plausibleValue()`), so
 * `Patient:` over a sentence names no one. A key line is never that value, except one whose key ends in a birth key,
 * such as `Max Beispiel DOB: 01.01.1960`. A table follows `headerBlock()`: the header block ends at it, so
 * `| Name | Stefan Kern |` never counts, while `| Patient | … |` counts anywhere.
 */
export function keyLines(markdown: string): KeyLine[] {
  const lines: KeyLine[] = [];
  const header = headerBlock();
  let table: string[][] | null = null;
  let row: string[] | null = null;
  let bare: { line: string; header: boolean } | null = null;
  const tokens = md.parse(markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n"), {});
  tokens.forEach((t, i) => {
    header.see(t, tokens[i + 1]);
    if (t.type === "table_open") table = [];
    else if (t.type === "table_close" && table) {
      lines.push(...keyValueRows(table, header.open));
      table = null;
    } else if (t.type === "tr_open") row = [];
    else if (t.type === "tr_close" && row) {
      table?.push(row);
      row = null;
    } else if (t.type === "inline" && row) row.push(t.content);
    if (table || t.type === "hr") bare = null;
    if (table || !["inline", "fence", "code_block", "html_block"].includes(t.type)) return;
    // Only a paragraph or an HTML block gives the value of a key above it, never a heading or a code block.
    if (t.type !== "html_block" && (t.type !== "inline" || tokens[i - 1]?.type !== "paragraph_open")) bare = null;
    for (const line of t.content.split("\n").filter((l) => unmark(l))) {
      const isBare = isBareIdentityKey(line);
      const own = toKeyLine(line, header.open);
      const joined = bare && !isBare && (!own || ENDS_IN_BIRTH_KEY.test(own.norm)) ? toKeyLine(`${bare.line} ${line}`, bare.header) : null;
      const kl = joined && plausibleValue(joined.norm, joined.value) ? joined : own;
      if (kl) lines.push(kl);
      bare = isBare ? { line: unmark(line), header: header.open } : null;
    }
  });
  return lines;
}

const BIRTH_CLAUSE = /^(.*?)(?:\s*,\s*|\s+)(?:born|dob|d\.o\.b\.?|date of birth)(?![a-z])\s*:?\s*(\S.*)$/i;

/**
 * A patient line value as name and birth clause: `Maria Beispiel, born 12 March 1961` or `BEISPIEL Maria, DOB 12.03.1961`.
 * The name is the whole value up to the birth clause. Null when anything else follows a comma, as in `Beispiel, Max`
 * or `Maria Beispiel, Max Beispiel`: such a line cannot be read safely.
 */
export function splitPatientValue(value: string): { name: string; birth: string | null } | null {
  const m = value.match(BIRTH_CLAUSE);
  const name = (m ? m[1] : value).trim();
  if (!name || name.includes(",")) return null;
  return { name, birth: m ? m[2].trim() : null };
}

export type PatientIdentity = {
  /** The name from the patient line, or from `First name` and `Surname`. Null unless exactly one and readable. */
  name: string | null;
  /** The birth date as written and read. Null unless the file gives exactly one. */
  birth: { text: string; date: IsoDate | null } | null;
  /** Why the name cannot be read, for the uploader. */
  errors: string[];
  refusals: { safety: SafetyRefusal; error: string }[];
};

/** Lower-case name words in order, so `BEISPIEL Maria`, `Maria Beispiel`, and `Maria Beispiel (f)` are the same patient. */
const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/\((?:f|m|w|d|x|female|male)\)/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .sort();

/** The patient as the file names them, and a refusal when the lines name more than one patient or birth date. */
export function patientIdentity(lines: KeyLine[]): PatientIdentity {
  const names = new Map<string, string>();
  const births = new Map<string, { text: string; date: IsoDate | null }>();
  const firsts = new Set<string>();
  const lasts = new Set<string>();
  const errors: string[] = [];
  const addName = (name: string) => names.set(words(name).join(" "), name);
  const addBirth = (raw: string) => {
    const text = raw.trim().replace(/[,;]$/, "");
    const date = parseDateWide(text) ?? parseDateWide(text.replace(/\.$/, "")) ?? leadingDate(text);
    births.set(date ?? `text:${text.toLowerCase()}`, { text, date });
  };
  for (const { norm, value, header } of lines) {
    if (PATIENT_KEYS.has(norm) || (header && HEADER_PATIENT_KEYS.has(norm))) {
      const split = splitPatientValue(value);
      if (!split) {
        errors.push(`The patient line "${value}" has more than a name and a birth date such as ", born 12 March 1961".`);
        addName(value);
        continue;
      }
      addName(split.name);
      if (split.birth) addBirth(split.birth);
    } else if (BIRTH_KEYS.has(norm) || (header && HEADER_BIRTH_KEYS.has(norm))) addBirth(value);
    else if (header && FIRST_KEYS.has(norm)) firsts.add(value);
    else if (header && LAST_KEYS.has(norm)) lasts.add(value);
  }

  const refusals: PatientIdentity["refusals"] = [];
  const severalPatients = () => refusals.push({ safety: "several-patients", error: "The file names more than one patient." });
  if (firsts.size > 1 || lasts.size > 1) severalPatients();
  else if (firsts.size && lasts.size) addName(`${[...firsts][0]} ${[...lasts][0]}`);
  else if (firsts.size || lasts.size) {
    // Half a name must belong to the patient line, or it names someone else.
    const part = words([...firsts, ...lasts][0]);
    if (![...names.keys()].some((n) => part.every((w) => n.split(" ").includes(w)))) {
      if (names.size) severalPatients();
      else errors.push("The file gives only part of the patient's name.");
    }
  }
  if (names.size > 1 && !refusals.length) severalPatients();
  if (births.size > 1) refusals.push({ safety: "several-birth-dates", error: "The file gives more than one birth date for the patient." });
  return {
    name: names.size === 1 && !errors.length ? [...names.values()][0] : null,
    birth: births.size === 1 ? [...births.values()][0] : null,
    errors,
    refusals,
  };
}
