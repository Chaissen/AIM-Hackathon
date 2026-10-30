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

export function domainOf(address: string): string | null {
  const [local, domain, ...rest] = address.split("@");
  if (!local || !domain || rest.length > 0) return null;
  if ([...local].some((character) => character.trim() === "" || ",;<>".includes(character))) return null;
  const asciiDomain = [...domain].every((character) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-".includes(character));
  return asciiDomain ? domain : null;
}

const canonicalDomain = (domain: string) => (domain.endsWith(".") ? domain.slice(0, -1) : domain).toLowerCase();
export const sameDomain = (a: string, b: string) => canonicalDomain(a) === canonicalDomain(b);

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
