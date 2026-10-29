import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { LabResult, LabRow, PersonLine, RehabReport } from "./types";

// The scenario documents in track/scenario/documents as the parser should return them. For tests only.

const markdown = (name: string) => readFileSync(join(process.cwd(), "track/scenario/documents", name), "utf8");

const evaBrandl: PersonLine = {
  raw: "Dr. Eva Brandl, lab physician",
  titles: ["Dr."],
  given: "Eva",
  family: "Brandl",
  details: ["lab physician"],
};

const labRows = (inr: [number, string], aptt: number, platelets: number, fibrinogen: [number, string]): LabRow[] => {
  const interpretation = (value: number, low: number, high: number) => (value < low ? "L" : value > high ? "H" : "N");
  return [
    {
      test: "INR (prothrombin time)",
      value: inr[0],
      valueText: inr[1],
      ucum: null,
      unitText: "",
      low: 0.8,
      high: 1.2,
      rangeText: "0.8 to 1.2",
      loinc: "6301-6",
      interpretation: interpretation(inr[0], 0.8, 1.2),
    },
    {
      test: "aPTT",
      value: aptt,
      valueText: String(aptt),
      ucum: "s",
      unitText: "s",
      low: 25,
      high: 37,
      rangeText: "25 to 37",
      loinc: "14979-9",
      interpretation: interpretation(aptt, 25, 37),
    },
    {
      test: "Platelets",
      value: platelets,
      valueText: String(platelets),
      ucum: "10*9/L",
      unitText: "10^9/L",
      low: 150,
      high: 400,
      rangeText: "150 to 400",
      loinc: "777-3",
      interpretation: interpretation(platelets, 150, 400),
    },
    {
      test: "Fibrinogen",
      value: fibrinogen[0],
      valueText: fibrinogen[1],
      ucum: "g/L",
      unitText: "g/L",
      low: 2,
      high: 4,
      rangeText: "2.0 to 4.0",
      loinc: "3255-7",
      interpretation: interpretation(fibrinogen[0], 2, 4),
    },
  ];
};

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
  rows: labRows([1, "1.0"], 31, 245, [3.1, "3.1"]),
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
  rows: labRows([2.6, "2.6"], 44, 198, [3.4, "3.4"]),
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
