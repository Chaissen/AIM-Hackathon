// R4 makes an Observation with a vital sign code conform to a vital signs profile
// (https://hl7.org/fhir/R4/observation-vitalsigns.html), and the HL7 validator checks it: category `vital-signs`,
// the profile's own code, and a UCUM unit the profile allows. A lab table can carry vital signs, for example sO2 and
// the patient temperature on a blood gas report. The validator also counts related codes such as 2713-6 for sO2.
// docs/FHIR.md, validator traps.

export type VitalSign = {
  /** The profile's LOINC code, added next to the document's code when they differ. */
  code: string;
  /** UCUM codes the profile allows. */
  units: string[];
  /** A unit as people write it, for the parser's error message. */
  example: string;
};

const OXYGEN: VitalSign = { code: "2708-6", units: ["%"], example: "%" };
const TEMPERATURE: VitalSign = { code: "8310-5", units: ["Cel", "[degF]"], example: "°C" };
const WEIGHT: VitalSign = { code: "29463-7", units: ["g", "kg", "[lb_av]"], example: "kg" };
const perMinute = (code: string): VitalSign => ({ code, units: ["/min"], example: "/min" });
const length = (code: string): VitalSign => ({ code, units: ["cm", "[in_i]"], example: "cm" });

const VITAL_SIGNS = new Map<string, VitalSign>([
  ["2708-6", OXYGEN],
  ["2710-2", OXYGEN],
  ["2713-6", OXYGEN],
  ["20564-1", OXYGEN],
  ["59408-5", OXYGEN],
  ["8310-5", TEMPERATURE],
  ["8331-1", TEMPERATURE],
  ["29463-7", WEIGHT],
  ["3141-9", WEIGHT],
  ["8867-4", perMinute("8867-4")],
  ["9279-1", perMinute("9279-1")],
  ["8302-2", length("8302-2")],
  ["9843-4", length("9843-4")],
  ["39156-5", { code: "39156-5", units: ["kg/m2"], example: "kg/m2" }],
]);

/** The vital sign profile a LOINC code falls under, if any. */
export const vitalSign = (loinc: string): VitalSign | undefined => VITAL_SIGNS.get(loinc);

/** Blood pressure needs systolic and diastolic as components of one Observation, which one table row cannot carry. */
export const BLOOD_PRESSURE = new Set(["85354-9", "8480-6", "8462-4"]);
