import { ehvd, type EhvdClient } from "./client";
import { findOrganisation } from "./directory";

// The address check before sending (docs/EHVD.md, "How ordy uses the eHVD", and M1 in docs/IDENTITY.md).

export type AddressCheck =
  /** The domain matches the organisation's `mail`, or the request goes by SMS, which the eHVD cannot check. */
  | { result: "pass" }
  /** The domain differs. The request waits for Send anyway, and `misdelivery_caught` gets `address_mismatch`. */
  | { result: "mismatch"; domain: string; expectedDomain: string }
  /**
   * The eHVD could not confirm the address. The request waits for Send anyway too, because an unchecked address is
   * never a pass, but nothing was caught, so no `misdelivery_caught`.
   */
  | {
      result: "unchecked";
      reason: "invalid_address" | "organisation_not_listed" | "several_organisations" | "no_mail" | "not_searchable" | "ehvd_unreachable" | "ehvd_error";
    };

/**
 * The domain of one plain address, as typed, or null for anything else: several `@`, a list, spaces, or a domain that is
 * not ASCII letters, digits, dots, and hyphens. Lowercasing a non-ASCII domain could turn it into the organisation's,
 * such as the Kelvin sign into `k`.
 */
const domainOf = (address: string) => /^[^\s@,;<>]+@([A-Za-z0-9.-]+)$/.exec(address)?.[1] ?? null;
// Domain names compare case-insensitively, and a trailing dot names the same domain.
const sameDomain = (a: string, b: string) => a.toLowerCase().replace(/\.$/, "") === b.toLowerCase().replace(/\.$/, "");

export async function checkAddress(
  request: { channel: "email" | "sms"; address: string; org: string },
  client: EhvdClient = ehvd,
): Promise<AddressCheck> {
  if (request.channel === "sms") return { result: "pass" };
  const domain = domainOf(request.address);
  // The request procedure accepts only valid email addresses, so this is only a guard.
  if (!domain) return { result: "unchecked", reason: "invalid_address" };

  const lookup = await findOrganisation(client, request.org);
  if (!lookup.ok) {
    const reason = (
      { not_listed: "organisation_not_listed", several: "several_organisations", not_searchable: "not_searchable", ehvd_unreachable: "ehvd_unreachable", ehvd_error: "ehvd_error" } as const
    )[lookup.reason];
    return { result: "unchecked", reason };
  }
  const expectedDomain = lookup.organisation.mail ? domainOf(lookup.organisation.mail) : null;
  if (!expectedDomain) return { result: "unchecked", reason: "no_mail" };
  return sameDomain(domain, expectedDomain) ? { result: "pass" } : { result: "mismatch", domain, expectedDomain };
}

/** The warning next to Send anyway in the widget (docs/ARCHITECTURE.md, "Widget"). Plain text: the names come from input. */
export function addressWarning(check: Exclude<AddressCheck, { result: "pass" }>, org: string): string {
  if (check.result === "mismatch") return `The address domain ${check.domain} does not match ${org} (${check.expectedDomain}).`;
  switch (check.reason) {
    case "invalid_address":
      return "The address is not a single plain email address, so it could not be checked.";
    case "organisation_not_listed":
      return `The eHVD does not list ${org} as an active organisation, so the address could not be checked.`;
    case "several_organisations":
      return `The eHVD lists more than one entry named ${org}, so the address could not be checked.`;
    case "no_mail":
      return `The eHVD has no email address for ${org}, so the address could not be checked.`;
    case "not_searchable":
      return `The organisation name ${org} cannot be searched in the eHVD, so the address could not be checked.`;
    case "ehvd_unreachable":
      return "The eHVD could not be reached, so the address could not be checked.";
    case "ehvd_error":
      return "The eHVD answered with an error, so the address could not be checked.";
  }
}
