import { addressWarning, type AddressCheck, domainOf, sameDomain } from "@/lib/address-check";
import { isSubset, nameWords } from "@/server/identity/names";

import { ehvd, type EhvdClient } from "./client";
import { findOrganisation, isActive, isPerson, type OrganisationLookup } from "./directory";

// The address check before sending (docs/EHVD.md, "How ordy uses the eHVD", and M1 in docs/IDENTITY.md), and the
// advisory recipient check the request form runs while Dr. Hofer types.

export async function checkAddress(
  request: { channel: "email" | "sms"; address: string; org: string },
  client: EhvdClient = ehvd,
): Promise<AddressCheck> {
  if (request.channel === "sms") return { result: "pass" };
  const domain = domainOf(request.address);
  // The request procedure accepts only valid email addresses, so this is only a guard.
  if (!domain) return { result: "unchecked", reason: "invalid_address" };

  return compareDomain(domain, await findOrganisation(client, request.org));
}

/** The address's domain against the organisation's `mail` domain, once the organisation lookup ran. */
function compareDomain(domain: string, lookup: OrganisationLookup): AddressCheck {
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

/** What the eHVD says about a recipient before the request exists. Advisory: `request.create` runs its own address check. */
export type RecipientCheck = {
  organisation: { status: "listed"; name: string } | { status: "not_listed" } | { status: "unchecked" };
  person: { status: "member"; name: string } | { status: "not_member" } | { status: "not_listed" } | { status: "unchecked" };
  address: { status: "match" } | { status: "mismatch"; domain: string; expectedDomain: string } | { status: "unchecked"; reason: string } | { status: "sms" };
};

export type Recipient = { given: string; family: string; org: string; channel: "email" | "sms"; address: string };

/** Persons per name search: the service-wide maximum, as in the release check. */
const PERSON_RESULTS = 200;

const wordSegmenter = new Intl.Segmenter("de", { granularity: "word" });
/** The longest word of a name as typed. The eHVD does not fold spellings, so the search keeps "Müller" as it is. */
const longestWord = (name: string) =>
  Array.from(wordSegmenter.segment(name))
    .filter((s) => s.isWordLike)
    .reduce((longest, s) => (s.segment.length > longest.length ? s.segment : longest), "");

/**
 * Whether an active person with every word of the typed name is a member of the organisation. The search asks for the
 * family name's longest word as a substring with both statuses, like the release check, so it also finds double names.
 */
async function findMember(client: EhvdClient, recipient: Recipient, organisationOid: string): Promise<RecipientCheck["person"]> {
  const given = nameWords(recipient.given);
  const family = nameWords(recipient.family);
  // An empty set passes every subset test (docs/IDENTITY.md, "Name match").
  if (!given.size || !family.size) return { status: "unchecked" };
  const result = await client.gdaSearch({ surname: `*${longestWord(recipient.family)}*`, ehvdstatus: "Inaktiv", maxResults: PERSON_RESULTS });
  if (!result.ok) return { status: "unchecked" };
  const named = result.value.filter((gda) => isPerson(gda) && isSubset(family, nameWords(gda.surname)) && isSubset(given, nameWords(gda.firstname ?? "")));
  if (!named.length) return { status: "not_listed" };
  // An inactive entry may not release a document, so it does not count as a member.
  const member = named.find((gda) => isActive(gda) && gda.relations.memberof.includes(organisationOid));
  if (!member) return { status: "not_member" };
  return { status: "member", name: [member.title, member.firstname, member.surname].filter(Boolean).join(" ") };
}

/** The same comparison as `checkAddress`, on the lookup the recipient check already made. An SMS has no address check. */
function addressStatus(recipient: Recipient, lookup: OrganisationLookup): RecipientCheck["address"] {
  if (recipient.channel === "sms") return { status: "sms" };
  const domain = domainOf(recipient.address);
  const check: AddressCheck = domain ? compareDomain(domain, lookup) : { result: "unchecked", reason: "invalid_address" };
  switch (check.result) {
    case "pass":
      return { status: "match" };
    case "mismatch":
      return { status: "mismatch", domain: check.domain, expectedDomain: check.expectedDomain };
    case "unchecked":
      return { status: "unchecked", reason: addressWarning(check, recipient.org) };
    default:
      return check satisfies never;
  }
}

/** The organisation, the person, and the address domain. Reads the eHVD only. */
export async function checkRecipient(recipient: Recipient, client: EhvdClient = ehvd): Promise<RecipientCheck> {
  const lookup = await findOrganisation(client, recipient.org);
  if (!lookup.ok) {
    const organisation = lookup.reason === "not_listed" ? { status: "not_listed" as const } : { status: "unchecked" as const };
    return { organisation, person: { status: "unchecked" }, address: addressStatus(recipient, lookup) };
  }
  return {
    organisation: { status: "listed", name: lookup.organisation.surname },
    person: await findMember(client, recipient, lookup.organisation.id.id),
    address: addressStatus(recipient, lookup),
  };
}
