import { readFileSync } from "node:fs";

import type { LabResult, LabRow, PersonLine, RehabReport } from "./types";

// The scenario documents in track/scenario/documents as the parser returns them. For tests only;
// scenario-fixtures.test.ts keeps them equal to the parser output.

const markdown = (name: string) => readFileSync(new URL(`../../../track/scenario/documents/${name}`, import.meta.url), "utf8");

const evaBrandl: PersonLine = {
  raw: "Dr. Eva Brandl, lab physician",
  titles: ["Dr."],
  given: "Eva",
  family: "Brandl",
  details: ["lab physician"],
};

/** Each result as written in the document, with the flag the parser gives it. */
type Result = [valueText: string, interpretation: LabRow["interpretation"]];

const labRows = (inr: Result, aptt: Result, platelets: Result, fibrinogen: Result): LabRow[] => [
  {
    test: "INR (prothrombin time)",
    value: Number(inr[0]),
    valueText: inr[0],
    ucum: null,
    unitText: "",
    low: 0.8,
    high: 1.2,
    rangeText: "0.8 to 1.2",
    loinc: "6301-6",
    interpretation: inr[1],
  },
  {
    test: "aPTT",
    value: Number(aptt[0]),
    valueText: aptt[0],
    ucum: "s",
    unitText: "s",
    low: 25,
    high: 37,
    rangeText: "25 to 37",
    loinc: "14979-9",
    interpretation: aptt[1],
  },
  {
    test: "Platelets",
    value: Number(platelets[0]),
    valueText: platelets[0],
    ucum: "10*9/L",
    unitText: "10^9/L",
    low: 150,
    high: 400,
    rangeText: "150 to 400",
    loinc: "777-3",
    interpretation: platelets[1],
  },
  {
    test: "Fibrinogen",
    value: Number(fibrinogen[0]),
    valueText: fibrinogen[0],
    ucum: "g/L",
    unitText: "g/L",
    low: 2,
    high: 4,
    rangeText: "2.0 to 4.0",
    loinc: "3255-7",
    interpretation: fibrinogen[1],
  },
];

export const labResultMaria: LabResult = {
  type: "lab-result",
  title: "Labor Kanalstraße: lab report",
  organisation: "Labor Kanalstraße",
  kind: "lab report",
  patient: { name: "Maria Beispiel", birthDate: "1961-03-12" },
  fields: {
    Patient: "Maria Beispiel, born 12 March 1961",
    "Requested by": "Dr. Lena Hofer, Klinikum Beispielstadt",
    "Sample taken": "22 October 2026, 08:10",
    Reported: "22 October 2026, 11:40",
    "Validated by": evaBrandl.raw,
  },
  markdown: markdown("lab-result-maria-beispiel.md"),
  sampleTaken: "2026-10-22T08:10:00+02:00",
  reported: "2026-10-22T11:40:00+02:00",
  rows: labRows(["1.0", "N"], ["31", "N"], ["245", "N"], ["3.1", "N"]),
  conclusion: "All values are within the reference range.",
  validatedBy: evaBrandl,
};

export const labResultMax: LabResult = {
  ...labResultMaria,
  patient: { name: "Max Beispiel", birthDate: "1960-01-01" },
  fields: {
    ...labResultMaria.fields,
    Patient: "Max Beispiel, born 1 January 1960",
    "Sample taken": "22 October 2026, 08:25",
    Reported: "22 October 2026, 11:45",
  },
  markdown: markdown("lab-result-max-beispiel.md"),
  sampleTaken: "2026-10-22T08:25:00+02:00",
  reported: "2026-10-22T11:45:00+02:00",
  rows: labRows(["2.6", "H"], ["44", "H"], ["198", "N"], ["3.4", "N"]),
  conclusion: "INR and aPTT are raised, as expected under anticoagulation with phenprocoumon.",
};

export const rehabReportMaria: RehabReport = {
  type: "rehab-report",
  title: "Reha Waldblick: discharge report",
  organisation: "Reha Waldblick",
  kind: "discharge report",
  patient: { name: "Maria Beispiel", birthDate: "1961-03-12" },
  fields: {
    Patient: "Maria Beispiel, born 12 March 1961",
    Stay: "2 to 23 September 2026",
    Reason: "rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt",
    "Written by": "Dr. Johanna Leitner, medical director, Reha Waldblick",
    "Sent by": "Stefan Kern, discharge management",
  },
  markdown: markdown("rehab-report-maria-beispiel.md"),
  stay: { start: "2026-09-02", end: "2026-09-23" },
  reason: "rehabilitation after a total hip replacement on the left, on 18 August 2026 at Klinikum Beispielstadt",
  sections: [
    {
      heading: "Course",
      text: "On arrival, Maria walked with two crutches. After three weeks of physiotherapy she walks up to 500 metres without aids and climbs stairs with a handrail. The wound healed without problems. There were no falls.",
    },
    {
      heading: "Medication at discharge",
      text: "- Rivaroxaban 10 mg once a day until 29 September 2026, to prevent thrombosis for six weeks after the operation\n- Paracetamol 500 mg up to three times a day if needed\n- Pantoprazole 20 mg once a day",
    },
    {
      heading: "Recommendations",
      text: "- Continue the home exercises.\n- Outpatient physiotherapy twice a week for six weeks.\n- Follow-up X-ray at Klinikum Beispielstadt in November 2026.",
    },
  ],
  writtenBy: {
    raw: "Dr. Johanna Leitner, medical director, Reha Waldblick",
    titles: ["Dr."],
    given: "Johanna",
    family: "Leitner",
    details: ["medical director", "Reha Waldblick"],
  },
  sentBy: {
    raw: "Stefan Kern, discharge management",
    titles: [],
    given: "Stefan",
    family: "Kern",
    details: ["discharge management"],
  },
};
