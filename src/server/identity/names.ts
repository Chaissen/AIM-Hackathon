// Name comparison from docs/IDENTITY.md ("Name match"). Shared by the patient check (T11) and the identity checks (T08).

/**
 * One title word, also joined ones and the Austrian female forms:
 * `Dr.`, `DDr.`, `Dr.in`, `Mag.a`, `Univ.-Prof.`, `Dipl.-Ing.`, `Prim.`. Joined titles need a dot or hyphen between them
 * and the female ending needs its dot, so `Magdi` and `Dia` stay names.
 */
export const TITLE = /^(?:d?dr|mag|prof|univ|med|di|ing|dipl|prim)(?:\.(?:in|a))?(?:[.-]+(?:d?dr|mag|prof|univ|med|di|ing|dipl|prim)(?:\.(?:in|a))?)*\.?$/i;
const SPELL_OUT: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" };

/** Spells out umlauts, drops other accents, and splits at spaces, hyphens, dots, and commas. */
function plainWords(text: string): string[] {
  return text
    .replace(/[äöüß]/g, (c) => SPELL_OUT[c])
    .replace(/[-.,]/g, " ")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Lowercase name words without titles. Umlauts are spelled out, other accents dropped, so "Müller" and "Mueller" match. */
export function nameWords(name: string): Set<string> {
  // NFC first: a decomposed "ü" would otherwise lose its umlaut instead of becoming "ue".
  const tokens = name.normalize("NFC").toLowerCase().split(/\s+/).filter(Boolean);
  const untitled = tokens.filter((t) => !TITLE.test(t.replace(/,+$/, ""))); // also "Beispiel, Dr.in, Maria"
  const words = plainWords(untitled.join(" ")).filter((w) => !TITLE.test(w)); // also "Dr.Eva" without a space
  // A name made only of title-like words, such as the given name "Di", keeps them.
  // The empty set would pass every subset test and let any name through.
  return new Set(words.length ? words : plainWords(tokens.join(" ")));
}

/** Every word in `a` is also in `b`. An empty `a` passes, so callers must refuse empty names. */
export const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));

/** At least one word of `a` is also in `b`. */
export const shares = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));
