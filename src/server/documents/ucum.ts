// Lab documents write units as people do, FHIR wants UCUM (docs/FHIR.md, validator traps). Only units on this list
// get a UCUM code. Any other unit stays text, so it can never fail the UCUM check, and a spelling that means something
// else in UCUM is never coded: `G/L` is gauss per litre, and `mU/L`, `U/mL`, or `kU/L` on a lab report often mean
// international or arbitrary units (TSH, tumour markers, IgE), not enzyme units.

export const UCUM_CODES: ReadonlySet<string> = new Set([
  // Counts
  "10*9/L",
  "10*12/L",
  "10*3/uL",
  "10*6/uL",
  "/uL",
  "/nL",
  "/pL",
  // Mass and substance concentrations
  "g/L",
  "g/dL",
  "mg/L",
  "mg/dL",
  "ug/L",
  "ug/dL",
  "ug/mL",
  "ng/mL",
  "ng/dL",
  "ng/L",
  "pg/mL",
  "mmol/L",
  "umol/L",
  "nmol/L",
  "pmol/L",
  "mmol/mol",
  "mg/mmol",
  // Enzyme and hormone activities
  "U/L",
  "[IU]/L",
  "[IU]/mL",
  "m[IU]/L",
  "m[IU]/mL",
  "u[IU]/mL",
  // Other lab units
  "%",
  "fL",
  "pg",
  "L/L",
  "s",
  "min",
  "h",
  "mm/h",
  "mL/min",
  "mosm/kg",
  "[pH]",
  "mm[Hg]",
  "kPa",
  // Vital signs a lab table may carry (vital-signs.ts)
  "Cel",
  "[degF]",
  "/min",
  "g",
  "kg",
  "cm",
  "kg/m2",
]);

/** Whole units with another name in UCUM. */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["°C", "Cel"],
  ["℃", "Cel"],
  ["°F", "[degF]"],
  ["℉", "[degF]"],
  ["pH", "[pH]"],
  // Heart and breathing rates: the vital signs profiles want `/min`.
  ["bpm", "/min"],
  ["1/min", "/min"],
]);

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUPERSCRIPTS = new RegExp(`[${SUPERSCRIPT}]+`, "g");
const POWER_OF_TEN = new RegExp(`10([${SUPERSCRIPT}]+)`);
const plain = (digits: string) => [...digits].map((c) => SUPERSCRIPT.indexOf(c)).join("");

/**
 * The UCUM code for a unit as written, for example `10^9/L` to `10*9/L`, `µmol/l` to `umol/L`, `x10^9/L` to `10*9/L`,
 * `IU/L` to `[IU]/L`, or `°C` to `Cel`. Null for an empty unit and for any unit not on the list.
 */
export function toUcum(unit: string): string | null {
  const written = unit.trim();
  const code = (ALIASES.get(written) ?? written)
    // Powers of ten: `10⁹` and `10^9` are `10*9`, and a leading `x` or `×` goes. The `x` step needs the `*` already there.
    .replace(POWER_OF_TEN, (_, power: string) => `10*${plain(power)}`)
    .replace(SUPERSCRIPTS, plain)
    // Other powers are plain digits after the unit: `kg/m^2` is `kg/m2`, as `kg/m²` is.
    .replace(/(?<=[A-Za-z])\^(?=\d)/g, "")
    .replace(/\^/g, "*")
    .replace(/^[xX×]\s*(?=10\*)/, "")
    // Atoms: micro is `u`, mercury and international units go in brackets, osmole is lower case.
    .replace(/[µμ]/g, "u")
    .replace(/mm ?Hg/, "mm[Hg]")
    .replace(/(?<!\[)IU(?!\])/g, "[IU]")
    .replace(/Osm/, "osm")
    // Litre is `L` after a prefix or a slash. This runs after the micro step, so `µl` becomes `uL`.
    .replace(/(^|\/|[munpfd])l(?=$|\/)/g, "$1L");
  return UCUM_CODES.has(code) ? code : null;
}
