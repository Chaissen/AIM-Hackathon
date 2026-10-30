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
  | { result: "unchecked"; reason: "organisation_not_listed" | "several_organisations" | "no_mail" | "not_searchable" | "ehvd_unavailable" };

/** The part after the last `@`, as typed. */
const domainOf = (address: string) => {
  const at = address.lastIndexOf("@");
  return at > 0 && at < address.length - 1 ? address.slice(at + 1).trim() : null;
};
// Domain names compare case-insensitively, and a trailing dot names the same domain.
const sameDomain = (a: string, b: string) => a.toLowerCase().replace(/\.$/, "") === b.toLowerCase().replace(/\.$/, "");

export async function checkAddress(
  request: { channel: "email" | "sms"; address: string; org: string },
  client: EhvdClient = ehvd,
): Promise<AddressCheck> {
  if (request.channel === "sms") return { result: "pass" };
  const domain = domainOf(request.address);
  // The request procedure accepts only valid email addresses, so this is only a guard.
  if (!domain) return { result: "unchecked", reason: "not_searchable" };

  const lookup = await findOrganisation(client, request.org);
  if (!lookup.ok) {
    const reason = ({ not_listed: "organisation_not_listed", several: "several_organisations", not_searchable: "not_searchable", ehvd_unavailable: "ehvd_unavailable" } as const)[lookup.reason];
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
    case "organisation_not_listed":
      return `The eHVD does not list ${org} as an active organisation, so the address could not be checked.`;
    case "several_organisations":
      return `The eHVD lists more than one organisation named ${org}, so the address could not be checked.`;
    case "no_mail":
      return `The eHVD has no email address for ${org}, so the address could not be checked.`;
    case "not_searchable":
      return `The organisation name ${org} cannot be searched in the eHVD, so the address could not be checked.`;
    case "ehvd_unavailable":
      return "The eHVD could not be reached, so the address could not be checked.";
  }
}
