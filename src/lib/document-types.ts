// The document types table from organisations/ARCHITECTURE.md, "Document types".
// To add a type, add a row here and in the docs.
export const DOCUMENT_TYPES = {
  "lab-result": { label: "Lab result", messageName: "lab result", channel: "email" },
  "rehab-report": { label: "Rehab discharge report", messageName: "rehab discharge report", channel: "sms" },
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPES;
export const documentTypeKeys = Object.keys(DOCUMENT_TYPES) as [DocumentType, ...DocumentType[]];
