import MarkdownIt from "markdown-it";

import { parseDateWide } from "./dates";
import type { IsoDate, SafetyRefusal } from "./types";

// Finds every line that names the patient or gives the patient's birth date, wherever it is written: plain text,
// a heading, bold, a list, a code block, or HTML. The parser and the AI fallback both refuse a file in which these
// lines disagree, so a second patient cannot hide in a form either of them does not read (docs/ARCHITECTURE.md).

/** A `key: value` line with its markup stripped. `norm` is the key in lower case, without `(2)` and a final `.`. */
export type KeyLine = { key: string; norm: string; value: string };

// HTML on, so an HTML block comes back as one token that we read as text, not as escaped text.
const md = new MarkdownIt({ html: true });
const KEY = /^[A-Za-z][A-Za-z' .-]*(?:\s*\([^)]*\))?$/;

/** `**Patient name:** Max`, `Patient’s name: Max`, `- Patient:Max`, or `<b>Name</b>: Max` as a key line, or null. */
export function toKeyLine(line: string): KeyLine | null {
  const clean = line.replace(/<[^>]*>/g, " ").replace(/[’‘ʼ´`]/g, "'").trim();
  const colon = clean.indexOf(":");
  if (colon <= 0) return null;
  const key = clean
    .slice(0, colon)
    .replace(/^(?:[\s#>*_+-]|\d+[.)]\s)+/, "")
    .replace(/[*_]/g, "")
    .trim();
  const value = clean
    .slice(colon + 1)
    .replace(/^[\s*_]+|[\s*_]+$/g, "")
    .replace(/\s+/g, " ");
  if (!value || key.length > 50 || !KEY.test(key)) return null;
  const norm = key.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  return { key: key.replace(/\s+/g, " "), norm, value };
}

/** Every key line outside tables: paragraphs, headings, list items, code blocks, and HTML blocks. */
export function keyLines(markdown: string): KeyLine[] {
  const lines: KeyLine[] = [];
  let tableDepth = 0;
  for (const t of md.parse(markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n"), {})) {
    if (t.type === "table_open") tableDepth++;
    else if (t.type === "table_close") tableDepth--;
    else if (!tableDepth && ["inline", "fence", "code_block", "html_block"].includes(t.type)) {
      for (const line of t.content.split("\n")) {
        const kl = toKeyLine(line);
        if (kl) lines.push(kl);
      }
    }
  }
  return lines;
}

/** Keys that name the patient. `Name:` counts too: a form may use it for the patient. */
export const PATIENT_KEYS = new Set(["patient", "name", "patient name", "patient's name", "name of patient", "name of the patient", "full name", "patient full name"]);
/** Keys for the patient's own birth date. `Mother's date of birth` is not one of them. */
export const BIRTH_KEYS = new Set([
  "date of birth",
  "birth date",
  "birthdate",
  "born",
  "dob",
  "d.o.b",
  "patient's date of birth",
  "patient date of birth",
  "patient's birth date",
  "patient birth date",
]);

export type PatientIdentity = {
  /** The whole name part of the patient line, up to the first comma or `born`, as written. Null unless exactly one. */
  name: string | null;
  /** The birth date as written and read. Null unless the file gives exactly one. */
  birth: { text: string; date: IsoDate | null } | null;
  refusals: { safety: SafetyRefusal; error: string }[];
};

/** The patient as the file names them, and a refusal when the lines name more than one patient or birth date. */
export function patientIdentity(lines: KeyLine[]): PatientIdentity {
  const names = new Map<string, string>();
  const births = new Map<string, { text: string; date: IsoDate | null }>();
  const addBirth = (raw: string) => {
    const text = raw.trim().replace(/[,;]$/, "");
    const date = parseDateWide(text) ?? parseDateWide(text.replace(/\.$/, ""));
    births.set(date ?? `text:${text.toLowerCase()}`, { text, date });
  };
  for (const { norm, value } of lines) {
    if (PATIENT_KEYS.has(norm)) {
      const name = value.split(/,|\bborn\b/i)[0].trim();
      if (name) names.set(name.toLowerCase(), name);
      const born = value.match(/\bborn\s+(.+)$/i);
      if (born) addBirth(born[1]);
    } else if (BIRTH_KEYS.has(norm)) addBirth(value);
  }
  const refusals: PatientIdentity["refusals"] = [];
  if (names.size > 1) refusals.push({ safety: "several-patients", error: "The file names more than one patient." });
  if (births.size > 1) refusals.push({ safety: "several-birth-dates", error: "The file gives more than one birth date for the patient." });
  return {
    name: names.size === 1 ? [...names.values()][0] : null,
    birth: births.size === 1 ? [...births.values()][0] : null,
    refusals,
  };
}
