import { GTELV_ROLE, SPECIALTY } from "./directory";

// English names for the codes ordy shows, from "Codes we use" in docs/EHVD.md, "Code systems". The eHVD writes each value
// as `<code system OID>:<code>`, and the code systems hold the official names in German.

const AUTHORISATION = "1.2.40.0.34.3.1.10";

const LABELS = new Map<string, string>([
  [`${GTELV_ROLE}:100`, "general practitioner"],
  [`${GTELV_ROLE}:158`, "specialist physician"],
  [`${GTELV_ROLE}:159`, "specialist physician"],
  [`${GTELV_ROLE}:300`, "general hospital"],
  [`${GTELV_ROLE}:301`, "special hospital"],
  [`${GTELV_ROLE}:304`, "independent outpatient clinic"],
  [`${SPECIALTY}:7`, "internal medicine"],
  [`${SPECIALTY}:12`, "physical medicine and general rehabilitation"],
  [`${SPECIALTY}:19`, "medical and chemical laboratory diagnostics"],
  [`${SPECIALTY}:49`, "neurology"],
  [`${AUTHORISATION}:0`, "general medicine"],
]);

/** The English names of eHVD code values, each once, with the value itself for a code ordy has no name for. */
export const codeLabels = (values: string[]) => [...new Set(values.map((value) => LABELS.get(value) ?? value))];
