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

const SPELL_OUT = new Map([
  ["ä", "ae"],
  ["ö", "oe"],
  ["ü", "ue"],
  ["ß", "ss"],
]);
const isDigit = (c: string) => c >= "0" && c <= "9";
const isWordChar = (c: string) => isDigit(c) || c.toLowerCase() !== c.toUpperCase();
const isCombiningMark = (c: string) => c >= "\u0300" && c <= "\u036f";

function words(text: string): string[] {
  // NFC first: a decomposed "ü" would otherwise lose its umlaut instead of becoming "ue".
  const spelled = Array.from(text.normalize("NFC").toLowerCase(), (c) => SPELL_OUT.get(c) ?? c).join("");
  const result: string[] = [];
  let word = "";
  for (const c of spelled.normalize("NFKD").toLowerCase()) {
    if (isCombiningMark(c)) continue;
    if (isWordChar(c)) word += c;
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

function forbiddenTerms(patient: ExpectedPatient): Term[] {
  return [
    ...oneWordTerms("patient-name", [...patient.given, patient.family].join(" ")),
    ...birthDateForms(patient.birthDate).map((form): Term => ({ category: "birth-date", words: words(form) })),
    ...DOCUMENT_TYPE_TERMS,
  ];
}

const occursIn = (term: string[], message: string[]) => message.some((_, i) => term.every((word, j) => message[i + j] === word));

export function forbiddenContent({ subject, text }: Email, patient: ExpectedPatient): ContentCategory[] {
  const message = words(`${subject}\n${text}`);
  const found = forbiddenTerms(patient).filter((term) => occursIn(term.words, message));
  return [...new Set(found.map((term) => term.category))];
}
