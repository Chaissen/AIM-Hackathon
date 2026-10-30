import type { EhvdClient, EhvdFailure } from "./client";
import type { GdaDescriptor } from "./soap";

// What the checks read from eHVD entries. docs/EHVD.md, "OIDs" and "Code systems".

/** The eHVD assigns organisation OIDs under this node and person OIDs under PERSON_NODE. */
export const ORGANISATION_NODE = "1.2.40.0.34.3.1.";
export const PERSON_NODE = "1.2.40.0.34.3.2.";

export const GTELV_ROLE = "1.2.40.0.34.5.2";
export const ELGA_ROLE = "1.2.40.0.34.5.3";
export const SPECIALTY = "1.2.40.0.34.3.1.10.20";

export const isOrganisation = (gda: GdaDescriptor) => gda.id.id.startsWith(ORGANISATION_NODE);
export const isPerson = (gda: GdaDescriptor) => gda.id.id.startsWith(PERSON_NODE);
export const isActive = (gda: GdaDescriptor) => gda.status.ehvdstatus === "Aktiv";

/** One of `codes` from `system` in `values`, which the eHVD writes as `<code system OID>:<code>`. */
export const hasCode = (values: string[], system: string, codes: string[]) => codes.some((code) => values.includes(`${system}:${code}`));

export type OrganisationLookup =
  | { ok: true; organisation: GdaDescriptor }
  | { ok: false; reason: "not_listed" | "several" | "not_searchable" | "ehvd_unavailable"; failure?: EhvdFailure };

/**
 * The one active organisation with this name (docs/EHVD.md, "How ordy uses the eHVD"). The search compares the whole
 * name, so "Labor Kanal" does not find Labor Kanalstraße. Persons with the same surname do not count.
 */
export async function findOrganisation(client: EhvdClient, name: string): Promise<OrganisationLookup> {
  const result = await client.gdaSearch({ surname: name.trim(), maxResults: 10, ehvdstatus: "Aktiv" });
  if (!result.ok) {
    const { failure } = result;
    if (failure.kind === "bad_request") return { ok: false, reason: "not_searchable", failure };
    if (failure.kind === "fault" && failure.code === 6005) return { ok: false, reason: "several", failure };
    return { ok: false, reason: "ehvd_unavailable", failure };
  }
  const found = result.value.filter((gda) => isOrganisation(gda) && isActive(gda));
  if (found.length === 0) return { ok: false, reason: "not_listed" };
  if (found.length > 1) return { ok: false, reason: "several" };
  return { ok: true, organisation: found[0] };
}
