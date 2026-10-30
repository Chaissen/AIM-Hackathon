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

const SPELL_OUT: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/**
 * An organisation name's words in order, lowercase, with umlauts spelled out and accents dropped. Unlike a person's
 * name words it keeps titles, since "Labor Dr. Huber" and "Labor Prof. Huber" are two organisations.
 */
const organisationWords = (name: string) =>
  name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => SPELL_OUT[c])
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** The same words in the same order, so the names differ at most in case, punctuation, and spelling, such as ß and ss. */
export const sameOrganisationName = (a: string, b: string) => {
  const [x, y] = [organisationWords(a), organisationWords(b)];
  return x.length > 0 && x.length === y.length && x.every((word, i) => word === y[i]);
};

/**
 * Why a call did not confirm anything: ordy refused to send the value, the eHVD could not be reached, or it answered with
 * a fault or something the WSDL does not describe.
 */
export type ServiceReason = "not_searchable" | "ehvd_unreachable" | "ehvd_error";

export const serviceReason = (failure: EhvdFailure): ServiceReason =>
  failure.kind === "bad_request" ? "not_searchable" : failure.kind === "unreachable" ? "ehvd_unreachable" : "ehvd_error";

export type OrganisationLookup = { ok: true; organisation: GdaDescriptor } | { ok: false; reason: "not_listed" | "several" | ServiceReason };

/** Organisations per search: the service-wide maximum, so 6005 needs more than 200 entries with exactly this name. */
const ORGANISATION_RESULTS = 200;

/**
 * The one active organisation with this name (docs/EHVD.md, "How ordy uses the eHVD"). The eHVD compares the whole
 * name, so "Labor Kanal" does not find Labor Kanalstraße. Persons with the same surname do not count, and every hit must
 * also have the name's words, whatever else the eHVD returns. A `*` in the name is refused: it would be a wildcard.
 */
export async function findOrganisation(client: EhvdClient, name: string): Promise<OrganisationLookup> {
  if (name.includes("*")) return { ok: false, reason: "not_searchable" };
  const result = await client.gdaSearch({ surname: name.trim(), maxResults: ORGANISATION_RESULTS, ehvdstatus: "Aktiv" });
  if (!result.ok) {
    const { failure } = result;
    if (failure.kind === "fault" && failure.code === 6005) return { ok: false, reason: "several" };
    return { ok: false, reason: serviceReason(failure) };
  }
  const found = result.value.filter((gda) => isOrganisation(gda) && isActive(gda) && sameOrganisationName(gda.surname, name));
  if (found.length === 0) return { ok: false, reason: "not_listed" };
  if (found.length > 1) return { ok: false, reason: "several" };
  return { ok: true, organisation: found[0] };
}
