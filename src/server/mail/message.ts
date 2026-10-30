import { DOCUMENT_TYPES } from "@/lib/document-types";
import type { ExpectedPatient } from "@/server/documents/patient-check";
import type { IsoDate } from "@/server/documents/types";

export type RequestEmail = { requester: string; clinic: string; link: string; expiresAt: Date };
export type Email = { subject: string; text: string };

const longDate = (timeZone: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone });
const viennaDate = longDate("Europe/Vienna");
const utcDate = longDate("UTC");

export function requestEmail({ requester, clinic, link, expiresAt }: RequestEmail): Email {
  return {
    subject: `Secure request from ${clinic}`,
    text: [
      "Hello,",
      "",
      `${requester} at ${clinic} has sent you a secure request.`,
      `Open it here: ${link}`,
      "",
      `You need ID Austria to open it. The link expires on ${viennaDate.format(expiresAt)}.`,
      "If you did not expect this message, you can ignore it.",
      "",
    ].join("\n"),
  };
}

export type ContentCategory = "patient-name" | "birth-date" | "document-type";
type Term = { category: ContentCategory; words: string[] };

// Umlauts are spelled out. Two letters fold because case changes them. Lowercasing "YILMAZ" gives i but "Yılmaz" has ı,
// and lowercasing "ΠΑΥΛΟΣ's" gives σ but "Παύλος" ends in ς.
const FOLD = new Map([
  ["ä", "ae"],
  ["ö", "oe"],
  ["ü", "ue"],
  ["ß", "ss"],
  ["ı", "i"],
  ["ς", "σ"],
]);
const isDigit = (c: string) => c >= "0" && c <= "9";
const isWordChar = (c: string) => isDigit(c) || c.toLowerCase() !== c.toUpperCase();
const graphemes = new Intl.Segmenter("und", { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter("und", { granularity: "word" });
// A mark that joins the character before it, such as an accent from any block, drops out without splitting the word.
const isMark = (c: string) => Array.from(graphemes.segment(`a${c}`)).length === 1;
// Spacing modifier letters, such as the apostrophe in "Лукʼян", have no case but belong to names in cased scripts.
const isModifierLetter = (c: string) => c >= "\u02b0" && c <= "\u02ff";
const isUncasedLetter = (c: string) => !isWordChar(c) && !isModifierLetter(c) && Boolean(wordSegmenter.segment(c).containing(0)?.isWordLike);

function fold(text: string): string {
  // Normalize to NFC first, or a decomposed "ü" loses its umlaut instead of becoming "ue".
  const spelled = Array.from(text.normalize("NFC").toLowerCase(), (c) => FOLD.get(c) ?? c).join("");
  return spelled.normalize("NFKD").toLowerCase();
}

function words(text: string): string[] {
  const result: string[] = [];
  let word = "";
  for (const c of fold(text)) {
    if (isWordChar(c)) word += c;
    else if (isMark(c)) continue;
    else if (word) {
      result.push(word);
      word = "";
    }
  }
  if (word) result.push(word);
  return result.map((w) => (Array.from(w).every(isDigit) ? BigInt(w).toString() : w));
}

const oneWordTerms = (category: ContentCategory, text: string): Term[] => words(text).map((word) => ({ category, words: [word] }));

const DOCUMENT_TYPE_TERMS = Object.values(DOCUMENT_TYPES).flatMap((type) => oneWordTerms("document-type", type.forbiddenWords.join(" ")));

function birthDateForms(birthDate: IsoDate): string[] {
  if (!birthDate) return [];
  const [year, month, day] = birthDate.split("-");
  return [birthDate, `${day}.${month}.${year}`, utcDate.format(Date.UTC(Number(year), Number(month) - 1, Number(day)))];
}

const patientName = (patient: ExpectedPatient) => [...patient.given, patient.family].join(" ");

function forbiddenTerms(patient: ExpectedPatient): Term[] {
  return [
    ...oneWordTerms("patient-name", patientName(patient)),
    ...birthDateForms(patient.birthDate).map((form): Term => ({ category: "birth-date", words: words(form) })),
    ...DOCUMENT_TYPE_TERMS,
  ];
}

const occursIn = (term: string[], message: string[]) => message.some((_, i) => term.every((word, j) => message[i + j] === word));

export function forbiddenContent({ subject, text }: Email, patient: ExpectedPatient): ContentCategory[] {
  const message = words(`${subject}\n${text}`);
  const found = forbiddenTerms(patient)
    .filter((term) => occursIn(term.words, message))
    .map((term) => term.category);
  // Whole words need letters with case. A name in a script without case, such as Chinese, could hide inside any word.
  if (Array.from(fold(patientName(patient))).some(isUncasedLetter)) found.unshift("patient-name");
  return [...new Set(found)];
}
