// M1 is caught only if the wrong person "cannot see the patient or the type of document" (track/scenario/misdelivery.md).
// This finds what of the patient or the document type a page sends to them. It searches the whole HTML, scripts
// included: Next.js sends the props of client components in `<script>self.__next_f.push(...)</script>`, so data the
// page does not show still reaches the browser.
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { nameWords } from "@/server/identity/names";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The birth date in the formats of docs/ARCHITECTURE.md ("Outgoing messages"): 1961-03-12, 12.03.1961, 12 March 1961.
export function birthDateFormats(iso: string): string[] {
  const [y, m, d] = iso.split("-");
  return [iso, `${d}.${m}.${y}`, `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`];
}

const ENTITIES: Record<string, string> = { quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", amp: "&" };

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });

// Undoes one level of JSON and JS string escapes: \" \\ \/ \uXXXX \xXX, and \n \r \t as spaces.
const unescapeOnce = (s: string) =>
  s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return "nrt".includes(e) ? " " : e;
  });

// The page as text: entities decoded, escapes undone until nothing changes (the flight data is escaped twice), and the
// angle brackets replaced by spaces. Script content and attribute values stay, because both reach the browser.
export function pageText(html: string): string {
  let text = decodeEntities(html);
  for (let i = 0; i < 5; i++) {
    const next = unescapeOnce(text);
    if (next === text) break;
    text = next;
  }
  return text.replace(/[<>]/g, " ").replace(/\s+/g, " ");
}

// Patient name words as whole words ("Beispielstadt" is not "Beispiel"), the birth date, and the document type as
// key (`lab-result`) or name (`lab result`).
export function revealedOnPage(html: string, patient: { name: string; birthDate: string }): string[] {
  const text = pageText(html);
  const lower = text.toLowerCase();
  const words = nameWords(text.replace(/[^\p{L}\p{N}\s.,-]/gu, " "));
  const docTypes = Object.entries(DOCUMENT_TYPES).flatMap(([key, t]) => [key, t.messageName]);
  return [
    ...[...nameWords(patient.name)].filter((w) => words.has(w)),
    ...birthDateFormats(patient.birthDate).filter((f) => lower.includes(f.toLowerCase())),
    ...docTypes.filter((t) => new RegExp(`(?<![\\w-])${t.replace(/[ -]/g, (c) => (c === " " ? "\\s+" : "-"))}(?![\\w-])`, "i").test(text)),
  ];
}
