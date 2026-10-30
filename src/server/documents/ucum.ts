// Lab documents write units as people do, FHIR wants UCUM (docs/FHIR.md, validator traps). Only units on this list
// get a UCUM code. Any other unit stays text, so it can never fail the UCUM check, and a spelling that means something
// else in UCUM is never coded: `G/L` is gauss per litre, and `mU/L` on a lab report usually means milli-international
// units, not milli-enzyme units.

export const UCUM_CODES = new Set([
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
  "U/mL",
  "kU/L",
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
  // Vital signs a lab table may carry (src/server/fhir/vital-signs.ts)
  "Cel",
  "[degF]",
  "/min",
  "g",
  "kg",
  "cm",
  "kg/m2",
]);

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const plain = (digits: string) => [...digits].map((c) => SUPERSCRIPT.indexOf(c)).join("");

/**
 * The UCUM code for a unit as written, for example `10^9/L` to `10*9/L`, `µmol/l` to `umol/L`, `x10^9/L` to `10*9/L`,
 * `IU/L` to `[IU]/L`, or `°C` to `Cel`. Null for an empty unit and for any unit not on the list.
 */
export function toUcum(unit: string): string | null {
  const code = unit
    .trim()
    .replace(/10([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/, (_, power: string) => `10*${plain(power)}`)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, plain)
    .replace(/\^/g, "*")
    .replace(/[µμ]/g, "u")
    .replace(/^[xX×]\s*(?=10\*)/, "")
    .replace(/^°C$/, "Cel")
    .replace(/^°F$/, "[degF]")
    .replace(/^pH$/, "[pH]")
    .replace(/mm ?Hg/, "mm[Hg]")
    .replace(/Osm/, "osm")
    .replace(/(?<!\[)IU(?!\])/g, "[IU]")
    .replace(/(^|\/|[munpfd])l(?=$|\/)/g, "$1L");
  return UCUM_CODES.has(code) ? code : null;
}
