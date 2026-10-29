// Lab documents write units as people do, FHIR wants UCUM (docs/FHIR.md, validator traps). Only units on this list
// get a UCUM code. Any other unit stays text, so it can never fail the UCUM check, and a spelling that means something
// else in UCUM, such as `G/L` (gauss per litre), is never coded.

const KNOWN = new Set([
  // Counts
  "10*9/L",
  "10*12/L",
  "10*3/uL",
  "10*6/uL",
  "/uL",
  // Mass and substance concentrations
  "g/L",
  "g/dL",
  "mg/L",
  "mg/dL",
  "ug/L",
  "ug/mL",
  "ng/mL",
  "ng/L",
  "pg/mL",
  "mmol/L",
  "umol/L",
  "nmol/L",
  "pmol/L",
  "mmol/mol",
  // Enzyme and hormone activities
  "U/L",
  "U/mL",
  "mU/L",
  "[IU]/L",
  "[IU]/mL",
  "m[IU]/L",
  "m[IU]/mL",
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
]);

/**
 * The UCUM code for a unit as written, for example `10^9/L` to `10*9/L`, `µmol/l` to `umol/L`, `x10^9/L` to `10*9/L`,
 * or `IU/L` to `[IU]/L`. Null for an empty unit and for any unit not on the list.
 */
export function toUcum(unit: string): string | null {
  const code = unit
    .trim()
    .replace(/\^/g, "*")
    .replace(/[µμ]/g, "u")
    .replace(/^[x×]\s*(?=10\*)/, "")
    .replace(/(?<!\[)IU(?!\])/g, "[IU]")
    .replace(/(^|\/|[munpfd])l(?=$|\/)/g, "$1L");
  return KNOWN.has(code) ? code : null;
}
