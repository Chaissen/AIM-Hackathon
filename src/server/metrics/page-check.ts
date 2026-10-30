// M1 is caught only if the wrong person "cannot see the patient or the type of document" (track/scenario/misdelivery.md).
// This finds what of the patient or the document type a page shows to them.
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { nameWords } from "@/server/identity/names";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The birth date in the formats of docs/ARCHITECTURE.md ("Outgoing messages"): 1961-03-12, 12.03.1961, 12 March 1961.
export function birthDateFormats(iso: string): string[] {
  const [y, m, d] = iso.split("-");
  return [iso, `${d}.${m}.${y}`, `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`];
}

const plainText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

// Patient name words as whole words ("Beispielstadt" is not "Beispiel"), the birth date, and the document type names.
export function revealedOnPage(html: string, patient: { name: string; birthDate: string }): string[] {
  const text = plainText(html);
  const words = nameWords(text);
  const lower = text.toLowerCase();
  return [
    ...[...nameWords(patient.name)].filter((w) => words.has(w)),
    ...birthDateFormats(patient.birthDate).filter((f) => lower.includes(f.toLowerCase())),
    ...Object.values(DOCUMENT_TYPES)
      .map((t) => t.messageName)
      .filter((n) => new RegExp(`\\b${n.replace(/ /g, "\\s+")}\\b`, "i").test(text)),
  ];
}
