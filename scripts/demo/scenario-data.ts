// The scenario's requests and documents (track/scenario/README.md), shared by `pnpm demo:seed` and `pnpm scenario`.
// Synthetic data only.
import { readFile } from "node:fs/promises";

import type { Upload } from "./browser";

/** Request 1 and M1: Dr. Brandl's lab result, by email. The widget's form sends the same fields (docs/ARCHITECTURE.md, "Widget"). */
export const BRANDL = { docType: "lab-result", given: "Eva", family: "Brandl", org: "Labor Kanalstraße" } as const;
export const BRANDL_EMAIL = "eva.brandl@labor-kanal.example";
/** M1: the same address with a capital I instead of a lowercase l (track/scenario/misdelivery.md). */
export const BRANDL_EMAIL_TYPO = "eva.brandl@labor-kanaI.example";

/** Request 2: Stefan Kern's rehab discharge report, by SMS. */
export const KERN = { docType: "rehab-report", given: "Stefan", family: "Kern", org: "Reha Waldblick", phone: "+43 660 000 0101" } as const;

/** A document under the repository, by its path relative to this folder. */
export async function readDocument(path: string): Promise<Upload> {
  const bytes = new Uint8Array(await readFile(new URL(path, import.meta.url)));
  return { name: path.split("/").at(-1)!, bytes };
}

/** The three documents of track/scenario/documents/. */
export const SCENARIO_DOCUMENTS = {
  maxLab: await readDocument("../../track/scenario/documents/lab-result-max-beispiel.md"),
  mariaLab: await readDocument("../../track/scenario/documents/lab-result-maria-beispiel.md"),
  mariaRehab: await readDocument("../../track/scenario/documents/rehab-report-maria-beispiel.md"),
};
