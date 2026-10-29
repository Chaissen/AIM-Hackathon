// Name words for the name match (T08) and the patient check (T11). docs/IDENTITY.md, "Name match".
const TITLES = new Set(["dr", "mag", "prof", "med", "univ", "di", "ing"]);
const SPELL_OUT: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };

export function nameWords(name: string): Set<string> {
  const plain = name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => SPELL_OUT[c])
    .replace(/[-.,]/g, " ")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "");
  return new Set(plain.split(/\s+/).filter((w) => w && !TITLES.has(w)));
}

/** Every word in `a` is also in `b`. An empty `a` passes, so callers must refuse empty names. */
export const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));
export const shares = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));
