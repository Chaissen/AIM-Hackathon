// The document types table from docs/ARCHITECTURE.md, "Document types". `releaseCheck` is its "eHVD check" column.
// To add a type, add a row here and in the docs.
export const DOCUMENT_TYPES = {
  "lab-result": {
    label: "Lab result",
    description: "Blood tests and other lab values. They must come from the lab physician.",
    messageName: "lab result",
    channel: "email",
    responsibleKey: "Validated by",
    forbiddenWords: ["lab", "labor", "result", "befund"],
    releaseCheck:
      'Release check: the physician under "Validated by" is active, has the lab medicine specialty, and is a member of the named organisation.',
  },
  "rehab-report": {
    label: "Rehab discharge report",
    description: "The discharge report after a rehab stay.",
    messageName: "rehab discharge report",
    channel: "sms",
    responsibleKey: "Written by",
    forbiddenWords: ["rehab", "discharge", "report"],
    releaseCheck:
      'Release check: the physician under "Written by" is active and a member of the named organisation, which is an active hospital.',
  },
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPES;
export const documentTypeKeys = Object.keys(DOCUMENT_TYPES) as [DocumentType, ...DocumentType[]];
