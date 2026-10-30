import MarkdownIt from "markdown-it";

import { parseDateWide } from "./dates";
import type { IsoDate, SafetyRefusal } from "./types";

// Finds every line that names the patient or gives the patient's birth date, wherever it is written: plain text,
// a heading, bold, a list, a link, a code block, or HTML. The parser and the AI fallback both refuse a file in which
// these lines disagree, so a second patient cannot hide in a form either of them does not read (docs/ARCHITECTURE.md).

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

/**
 * `**Patient name:** Max`, `Patient’s name: Max`, `- Patient:Max`, `Patient： Max`, `[Patient: Max](#)`, or
 * `<b>Name</b>: Max` as a key line, or null. `Patient - Max` counts too, but only for keys that identify the patient.
 */
export function toKeyLine(line: string, header = true): KeyLine | null {
  const clean = line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[’‘ʼ´`]/g, "'")
    .replace(/[：﹕]/g, ":")
    .trim();
  const colon = clean.indexOf(":");
  const byColon = colon > 0 ? keyValue(clean.slice(0, colon), clean.slice(colon + 1), header) : null;
  if (byColon) return byColon;
  const dash = clean.match(/^(.{1,50}?)\s+[-–—]\s+(.+)$/);
  const byDash = dash ? keyValue(dash[1], dash[2], header) : null;
  return byDash && IDENTITY_KEYS.has(byDash.norm) ? byDash : null;
}

/** Every key line outside tables: paragraphs, headings, list items, code blocks, and HTML blocks. */
export function keyLines(markdown: string): KeyLine[] {
  const lines: KeyLine[] = [];
  const header = headerBlock();
  let tableDepth = 0;
  const tokens = md.parse(markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n"), {});
  tokens.forEach((t, i) => {
    header.see(t, tokens[i + 1]);
    if (t.type === "table_open") tableDepth++;
    else if (t.type === "table_close") tableDepth--;
    else if (!tableDepth && ["inline", "fence", "code_block", "html_block"].includes(t.type)) {
      for (const line of t.content.split("\n")) {
        const kl = toKeyLine(line, header.open);
        if (kl) lines.push(kl);
      }
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

/** Lower-case name words in order, so `BEISPIEL Maria` and `Maria Beispiel` are the same patient. */
const words = (name: string) => name.toLowerCase().split(/[\s-]+/).filter(Boolean).sort();

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
    const date = parseDateWide(text) ?? parseDateWide(text.replace(/\.$/, ""));
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
