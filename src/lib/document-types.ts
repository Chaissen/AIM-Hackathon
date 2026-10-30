// The document types table from docs/ARCHITECTURE.md, "Document types".
// To add a type, add a row here and in the docs.
export const DOCUMENT_TYPES = {
  "lab-result": {
    label: "Lab result",
    messageName: "lab result",
    channel: "email",
    responsibleKey: "Validated by",
    forbiddenWords: ["lab", "labor", "result", "befund"],
  },
  "rehab-report": {
    label: "Rehab discharge report",
    messageName: "rehab discharge report",
    channel: "sms",
    responsibleKey: "Written by",
    forbiddenWords: ["rehab", "discharge", "report"],
  },
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPES;
export const documentTypeKeys = Object.keys(DOCUMENT_TYPES) as [DocumentType, ...DocumentType[]];
