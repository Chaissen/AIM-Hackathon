// R4 makes an Observation with a vital sign code conform to a vital signs profile
// (https://hl7.org/fhir/R4/observation-vitalsigns.html): category `vital-signs`, the profile's own code, and a UCUM unit
// the profile allows. Which codes count is the HL7 validator's list (7.0.3, `getImpliedProfilesForObservation`).
// A lab table can carry vital signs, for example sO2 and the patient temperature on a blood gas report.
// docs/FHIR.md, validator traps.

export type VitalSign = {
  /** The profile's LOINC code, added next to the document's code when they differ. */
  readonly code: string;
  /** Codes the validator files under this profile as well. */
  readonly related: readonly string[];
  /** The UCUM codes the profile allows that the parser reads (`ucum.ts`). */
  readonly units: readonly string[];
  /** A unit as people write it, for the parser's reason. */
  readonly example: string;
};

export const VITAL_SIGNS: readonly VitalSign[] = [
  {
    code: "2708-6",
    related: ["20564-1", "2713-6", "51733-4", "59408-5", "59417-6", "89276-0"],
    units: ["%"],
    example: "%",
  },
  {
    code: "8310-5",
    related: [
      "60834-9", "60835-6", "60836-4", "60838-0", "60955-2", "61009-7", "75539-7", "75987-8", "76010-8", "76011-6", "76278-1",
      "8309-7", "8328-7", "8329-5", "8330-3", "8331-1", "8332-9", "8333-7", "8334-5", "91371-5", "98657-0", "98663-8",
    ],
    units: ["Cel", "[degF]"],
    example: "°C",
  },
  { code: "8302-2", related: ["3137-7", "3138-5", "8306-3", "8308-9"], units: ["cm"], example: "cm" },
  { code: "9843-4", related: ["8287-5"], units: ["cm"], example: "cm" },
  { code: "29463-7", related: ["3141-9", "3142-7", "75292-3", "79348-9", "8350-1", "8351-9"], units: ["g", "kg"], example: "kg" },
  { code: "39156-5", related: ["89270-3"], units: ["kg/m2"], example: "kg/m2" },
  {
    code: "8867-4",
    related: [
      "60978-4", "73795-7", "73799-9", "76476-1", "76477-9", "8886-4", "8889-8", "8890-6", "8891-4", "8892-2", "8893-0",
      "40443-4", "55425-3", "68999-2", "11328-2", "69000-8",
    ],
    units: ["/min"],
    example: "/min",
  },
  { code: "9279-1", related: ["76170-0", "76171-8", "76172-6", "19840-8", "33438-3", "76270-8", "11291-2"], units: ["/min"], example: "/min" },
];

const BY_CODE = new Map(VITAL_SIGNS.flatMap((v) => [v.code, ...v.related].map((code) => [code, v] as const)));

/** The vital sign profile a LOINC code falls under, if any. */
export const vitalSign = (loinc: string): VitalSign | undefined => BY_CODE.get(loinc);

const BLOOD_PRESSURE = "blood pressure needs systolic and diastolic together, which one table row cannot carry. Write it below the table.";
const NOT_ARTERIAL =
  "the FHIR profile for oxygen saturation adds the code for arterial blood, which a venous or capillary saturation is not. Write it below the table.";

/**
 * Vital sign codes that cannot be one table row, with the reason the parser gives. With `VITAL_SIGNS`, the validator's
 * list, plus diastolic 8462-4, which the list lacks but which cannot be a row either.
 */
export const REFUSED_VITAL_SIGNS: ReadonlyMap<string, string> = new Map([
  ...["85354-9", "35094-2", "8459-0", "76534-7", "55284-4", "8480-6", "8462-4"].map((code) => [code, BLOOD_PRESSURE] as const),
  ["85353-1", "a vital signs panel cannot be one table row. Give each vital sign its own row."],
  // Mixed venous, central venous, and capillary sO2: the validator wants 2708-6 (arterial) on them, which would file a
  // wrong code. sO2 in blood without a site (20564-1, calculated 2713-6) stays, as its code does not rule out arterial.
  ...["19224-5", "97549-0", "2709-4", "2710-2"].map((code) => [code, NOT_ARTERIAL] as const),
]);
