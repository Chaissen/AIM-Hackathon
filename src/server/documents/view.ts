import { parseDocument } from "./parse";
import type { LabResult, RehabReport } from "./types";

/** A held or filed answer as the widget shows it: the parsed document without its Markdown, which comes along once as `original`. */
export type DocumentView = Omit<LabResult, "markdown"> | Omit<RehabReport, "markdown">;

/**
 * Reads a held or filed answer's Markdown with the parser the answer flow uses. Null for anything but a lab result or a
 * rehab report: the answer flow refuses other documents, so such text was never held or filed by ordy.
 */
export function toDocumentView(markdown: string): { document: DocumentView; original: string } | null {
  const parsed = parseDocument(markdown);
  if (!parsed.ok) return null;
  switch (parsed.document.type) {
    case "lab-result":
    case "rehab-report": {
      const { markdown: original, ...document } = parsed.document;
      return { document, original };
    }
    case "other":
      return null;
    default:
      return parsed.document satisfies never;
  }
}
