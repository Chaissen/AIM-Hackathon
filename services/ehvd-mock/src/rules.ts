import type { GdaAddress, GetGdaFields, SearchFields } from "./soap.ts";

// Code points with Script=Latin and a General_Category of Letter, from Scripts.txt and UnicodeData of Unicode 17.0.
const latinLetters: readonly (readonly [number, number])[] = [
  [0x0041, 0x005a], [0x0061, 0x007a], [0x00aa, 0x00aa], [0x00ba, 0x00ba], [0x00c0, 0x00d6], [0x00d8, 0x00f6],
  [0x00f8, 0x02b8], [0x02e0, 0x02e4], [0x1d00, 0x1d25], [0x1d2c, 0x1d5c], [0x1d62, 0x1d65], [0x1d6b, 0x1d77],
  [0x1d79, 0x1dbe], [0x1e00, 0x1eff], [0x2071, 0x2071], [0x207f, 0x207f], [0x2090, 0x209c], [0x212a, 0x212b],
  [0x2132, 0x2132], [0x214e, 0x214e], [0x2183, 0x2184], [0x2c60, 0x2c7f], [0xa722, 0xa787], [0xa78b, 0xa7dc],
  [0xa7f1, 0xa7ff], [0xab30, 0xab5a], [0xab5c, 0xab64], [0xab66, 0xab69], [0xfb00, 0xfb06], [0xff21, 0xff3a],
  [0xff41, 0xff5a], [0x10780, 0x10785], [0x10787, 0x107b0], [0x107b2, 0x107ba], [0x1df00, 0x1df1e], [0x1df25, 0x1df2a],
];

const isLatinLetter = (char: string) => {
  const point = char.codePointAt(0) ?? -1;
  return latinLetters.some(([first, last]) => point >= first && point <= last);
};
const isDigit = (char: string) => char >= "0" && char <= "9";
const isAsciiLetter = (char: string) => (char >= "A" && char <= "Z") || (char >= "a" && char <= "z");
const punctuation = new Set([".", "-", "~", "_", "+", "=", "/"]);
const isNameChar = (char: string) => isLatinLetter(char) || isDigit(char) || char === " " || punctuation.has(char);
const isIdChar = (char: string) => isAsciiLetter(char) || isDigit(char) || char === "." || char === "-";
const isOidChar = (char: string) => isDigit(char) || char === ".";
const isRoleChar = (char: string) => isDigit(char) || char === "." || isLatinLetter(char);
const isOidArc = (arc: string) => arc === "0" || (arc !== "" && arc[0] !== "0" && [...arc].every(isDigit));
// ITU-T X.660 allows only 0, 1, and 2 as the first arc, and below 0 and 1 only 0 to 39 as the second.
const isOid = (text: string) => {
  const arcs = text.split(".");
  if (arcs.length < 2 || !arcs.every(isOidArc)) return false;
  const [first, second] = arcs;
  return first === "2" || ((first === "0" || first === "1") && Number(second) < 40);
};

type TextRule = { maxLength?: number; allowed: (char: string) => boolean; wildcard?: true; form?: (text: string) => boolean };

const textRules = {
  oidIssuingAuthority: { maxLength: 24, allowed: isOidChar, form: isOid },
  id: { maxLength: 40, allowed: isIdChar },
  firstname: { maxLength: 128, allowed: isNameChar, wildcard: true },
  surname: { maxLength: 128, allowed: isNameChar, wildcard: true },
  rolecode: { allowed: isRoleChar },
  postcode: { maxLength: 10, allowed: isDigit },
  streetNumber: { maxLength: 12, allowed: isNameChar },
  streetName: { maxLength: 88, allowed: isNameChar },
  city: { maxLength: 50, allowed: isNameChar },
  state: { maxLength: 20, allowed: isNameChar },
  description: { maxLength: 24, allowed: isNameChar, wildcard: true },
} satisfies Record<string, TextRule>;

type TextField = keyof typeof textRules;

export type Pattern = { match: "exact" | "prefix" | "suffix" | "contains"; text: string };

export const fold = (text: string) => text.normalize("NFC").toLowerCase();

function readText(rule: TextRule, value: string): Pattern | undefined {
  const chars = [...value.normalize("NFC")];
  if (rule.maxLength !== undefined && chars.length > rule.maxLength) return undefined;
  const leading = chars[0] === "*";
  const trailing = chars.length > 1 && chars[chars.length - 1] === "*";
  const core = chars.slice(leading ? 1 : 0, trailing ? -1 : chars.length);
  if ((leading || trailing) && !(rule.wildcard && core.filter(isAsciiLetter).length >= 2)) return undefined;
  if (!core.every(rule.allowed) || (rule.form && !rule.form(core.join("")))) return undefined;
  const match = leading && trailing ? "contains" : leading ? "suffix" : trailing ? "prefix" : "exact";
  return { match, text: fold(core.join("")) };
}

function readTexts<F extends TextField>(fields: Partial<Record<F, string>>, names: readonly F[]) {
  const patterns: Partial<Record<F, Pattern>> = {};
  for (const name of names) {
    const value = fields[name];
    if (value === undefined || value === "") continue;
    const pattern = readText(textRules[name], value);
    if (!pattern) return undefined;
    patterns[name] = pattern;
  }
  return patterns;
}

export type GetGdaRequest = { oidIssuingAuthority?: string; id: string };

export function readGetGda(fields: GetGdaFields): GetGdaRequest | undefined {
  const patterns = readTexts(fields, ["oidIssuingAuthority", "id"]);
  if (!patterns?.id) return undefined;
  return { oidIssuingAuthority: patterns.oidIssuingAuthority?.text, id: patterns.id.text };
}

export type SearchRequest = {
  firstname?: Pattern;
  surname: Pattern;
  description?: Pattern;
  rolecode?: string;
  address: { field: keyof GdaAddress; value: string }[];
  maxResults: number;
  activeOnly: { ehvdstatus: boolean; elgastatus: boolean };
};

const searchTexts = ["firstname", "surname", "rolecode", "postcode", "streetNumber", "streetName", "city", "state", "description"] as const;
const addressCriteria = [
  ["postcode", "zip"],
  ["streetNumber", "streetNumber"],
  ["streetName", "streetName"],
  ["city", "city"],
  ["state", "state"],
] as const;

function readMaxResults(value: string | undefined) {
  if (value === undefined || [...value].length > 3) return undefined;
  const count = Number(value);
  return count >= 1 && count <= 200 ? count : undefined;
}

function readActiveOnly(value: string | undefined) {
  if (value === "Aktiv") return true;
  if (value === undefined || value === "" || value === "Inaktiv") return false;
  return undefined;
}

export function readSearch(fields: SearchFields): SearchRequest | undefined {
  const patterns = readTexts(fields, searchTexts);
  const maxResults = readMaxResults(fields.maxResults);
  const ehvdstatus = readActiveOnly(fields.ehvdstatus);
  const elgastatus = readActiveOnly(fields.elgastatus);
  if (!patterns?.surname || maxResults === undefined || ehvdstatus === undefined || elgastatus === undefined) return undefined;
  return {
    firstname: patterns.firstname,
    surname: patterns.surname,
    description: patterns.description,
    rolecode: patterns.rolecode?.text,
    address: addressCriteria.flatMap(([name, field]) => {
      const pattern = patterns[name];
      return pattern ? [{ field, value: pattern.text }] : [];
    }),
    maxResults,
    activeOnly: { ehvdstatus, elgastatus },
  };
}
