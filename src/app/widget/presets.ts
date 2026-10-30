import type { RequestDraft } from "./draft";

/**
 * The Examples menu on New request: the scenario's two requests (docs/ARCHITECTURE.md, "Widget") and the M1 test with a
 * capital I for the l in the lab's domain, so the address check fires before sending.
 */
type RequestPreset = { label: string; draft: RequestDraft };

const BRANDL = { docType: "lab-result", patient: "maria-beispiel", given: "Eva", family: "Brandl", org: "Labor Kanalstraße", channel: "email" } as const;

export const REQUEST_PRESETS: readonly RequestPreset[] = [
  { label: "Lab result from Dr. Brandl", draft: { ...BRANDL, contact: "eva.brandl@labor-kanal.example" } },
  {
    label: "Rehab report from Stefan Kern",
    draft: { docType: "rehab-report", patient: "maria-beispiel", given: "Stefan", family: "Kern", org: "Reha Waldblick", channel: "sms", contact: "+43 660 000 0101" },
  },
  { label: "Typo in the email address (test M1)", draft: { ...BRANDL, contact: "eva.brandl@labor-kanaI.example" } },
];
