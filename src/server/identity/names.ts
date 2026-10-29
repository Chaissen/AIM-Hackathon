// Name comparison from docs/IDENTITY.md ("Name match"). Shared by the patient check (T11) and the identity checks (T08).

/**
 * One title word, also joined ones and the Austrian female forms:
 * `Dr.`, `DDr.`, `Dr.in`, `Mag.a`, `Univ.-Prof.`, `Dipl.-Ing.`, `Prim.`. The female ending needs its dot, so `Dia` stays a name.
 */
export const TITLE = /^(?:(?:d?dr|mag|prof|univ|med|di|ing|dipl|prim)(?:\.(?:in|a))?\.?-?)+$/i;
const SPELL_OUT: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };

/** Lowercase name words without titles. Umlauts are spelled out, other accents dropped, so "Müller" and "Mueller" match. */
export function nameWords(name: string): Set<string> {
  const plain = name
    .normalize("NFC") // a decomposed "ü" would otherwise lose its umlaut instead of becoming "ue"
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => !TITLE.test(w))
    .join(" ")
    .replace(/[äöüß]/g, (c) => SPELL_OUT[c])
    .replace(/[-.,]/g, " ")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "");
  return new Set(plain.split(/\s+/).filter((w) => w && !TITLE.test(w)));
}

/** Every word in `a` is also in `b`. An empty `a` passes, so callers must refuse empty names. */
export const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));
