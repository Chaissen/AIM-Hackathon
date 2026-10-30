import type { LabResult, PersonLine, RehabReport } from "@/server/documents/types";
import { isSubset, nameWords } from "@/server/identity/names";

import { ehvd, type EhvdClient } from "./client";
import {
  ELGA_ROLE,
  findOrganisation,
  GTELV_ROLE,
  hasCode,
  isActive,
  isPerson,
  type OrganisationLookup,
  sameOrganisationName,
  serviceReason,
  SPECIALTY,
} from "./directory";
import type { GdaDescriptor, GdaSearchQuery } from "./soap";

// The release check when an answer arrives, after the patient check (docs/IDENTITY.md, "Who may release a document",
// and docs/EHVD.md, "How ordy uses the eHVD"). It never blocks: anything the eHVD does not confirm is a hold.

export type ReleaseHoldReason =
  /** The document names nobody under `Validated by` or `Written by`. */
  | "no_responsible_person"
  /** The responsible person's given name or family name has no words, such as `Dr. Brandl`. */
  | "incomplete_name"
  /** The heading names another organisation than the request went to. */
  | "organisation_differs"
  | "organisation_not_listed"
  /** More than one active organisation with that name, or more than 200 entries with it (6005). */
  | "several_organisations"
  /** A rehab report from an organisation that is not an active hospital (`role` 300 or 301). */
  | "organisation_not_hospital"
  | "not_listed"
  | "not_active"
  /** Lab: not a specialist in laboratory medicine. Rehab: not a physician. */
  | "wrong_role"
  | "not_member"
  /** More than one active member of the organisation with that name. */
  | "several_matches"
  /** More than 200 entries even with the given name (6005), so the check cannot tell whether the name is unique. */
  | "too_many_matches"
  /** The eHVD entry for the OID in the sender's login names someone else than the document, or has another OID. */
  | "claim_differs"
  /** The eHVD has no person entry for the OID in the sender's login. */
  | "claim_not_listed"
  /** A name or organisation with characters the eHVD search does not allow. */
  | "not_searchable"
  /** No connection, no answer in time, or a refused connection. */
  | "ehvd_unreachable"
  /** The eHVD answered, but with a fault or with something the WSDL does not describe. */
  | "ehvd_error";

export type ReleaseCheck =
  | {
      verdict: "pass";
      via: "claim" | "search";
      practitioner: GdaDescriptor;
      organisation: GdaDescriptor;
      /** The GDA claim in the sender's login proves that the sender is the responsible person: true only via the claim. */
      senderIsResponsible: boolean;
    }
  | {
      verdict: "hold";
      /** A code for the audit entry, and `sentence` for the held notice (docs/ARCHITECTURE.md, "Matrix bot"). */
      reason: ReleaseHoldReason;
      sentence: string;
      /** What the check found before it held, for the filing if Dr. Hofer accepts the answer. Null if nothing, or if ambiguous. */
      organisation: GdaDescriptor | null;
      practitioner: GdaDescriptor | null;
    };

export type ReleaseInput = {
  document: LabResult | RehabReport;
  /** The organisation the request went to, as Dr. Hofer typed it. */
  org: string;
  /** The person who answered, from the ID Austria login. `gdaOid` is `gdaOidFromClaim`'s OID, or null without the claim. */
  sender: { givenName: string; familyName: string; gdaOid: string | null };
};

/** Persons per name search: the service-wide maximum, so only a very common name turns into fault 6005. */
const PERSON_RESULTS = 200;

/** The hold for each way the organisation lookup can fail. */
const ORGANISATION_HOLDS = {
  not_listed: "organisation_not_listed",
  several: "several_organisations",
  not_searchable: "not_searchable",
  ehvd_unreachable: "ehvd_unreachable",
  ehvd_error: "ehvd_error",
} as const satisfies Record<Extract<OrganisationLookup, { ok: false }>["reason"], ReleaseHoldReason>;

/** Text from the document or the request goes into the notice, so it is cut to a length a notice can carry. */
const clip = (text: string) => (text.length > 100 ? `${text.slice(0, 99)}…` : text);
const displayName = (person: PersonLine) => clip([...person.titles, person.given, person.family].filter(Boolean).join(" ").replace(/[.,;:]+$/, ""));

type NameWords = { given: Set<string>; family: Set<string> };

/**
 * Every word of the document's name is in the other name, family and given name each. The caller makes sure the
 * document's name has words in both, because an empty set passes every subset test (docs/IDENTITY.md, "Name match").
 */
const sameName = (document: NameWords, other: { given: string; family: string }) =>
  isSubset(document.family, nameWords(other.family)) && isSubset(document.given, nameWords(other.given));

const entryName = (gda: GdaDescriptor) => ({ given: gda.firstname ?? "", family: gda.surname });

/** What the document type needs of the responsible person (docs/IDENTITY.md, "The release check"). */
const hasRequiredRole = (type: "lab-result" | "rehab-report", gda: GdaDescriptor) =>
  type === "lab-result"
    ? hasCode(gda.roles.role, GTELV_ROLE, ["158", "159"]) && hasCode(gda.roles.specialisation, SPECIALTY, ["19"])
    : hasCode(gda.roles.elgaRole, ELGA_ROLE, ["700"]);

/** `person` is null when the hold is about the organisation, so the sentence names the organisation. */
function sentence(reason: ReleaseHoldReason, input: ReleaseInput, person: PersonLine | null): string {
  const name = person ? displayName(person) : "";
  const org = clip(input.org);
  const { document } = input;
  switch (reason) {
    case "no_responsible_person":
      return `The document names nobody under ${document.type === "lab-result" ? "Validated by" : "Written by"}.`;
    case "incomplete_name":
      return `The document does not give the full name of ${name}.`;
    case "organisation_differs":
      return `The document comes from ${clip(document.organisation)}, but the request went to ${org}.`;
    case "organisation_not_listed":
      return `The eHVD does not list ${org} as an active organisation.`;
    case "several_organisations":
      return `The eHVD lists more than one entry named ${org}.`;
    case "organisation_not_hospital":
      return `The eHVD does not list ${org} as a hospital.`;
    case "not_listed":
      return `The eHVD does not list ${name}.`;
    case "not_active":
      return `The eHVD lists ${name} as not active.`;
    case "wrong_role":
      return document.type === "lab-result"
        ? `The eHVD does not list ${name} as a specialist in medical and chemical laboratory diagnostics.`
        : `The eHVD does not list ${name} as a physician.`;
    case "not_member":
      return `The eHVD does not list ${name} as a member of ${org}.`;
    case "several_matches":
      return `The eHVD lists more than one ${name} at ${org}.`;
    case "too_many_matches":
      return `The eHVD lists too many people named ${clip(person?.family ?? "")} to confirm ${name}.`;
    case "claim_differs":
      return `The eHVD entry of the sender's ID Austria login is not ${name}.`;
    case "claim_not_listed":
      return `The eHVD has no person entry for the sender's ID Austria login, so it cannot confirm ${name}.`;
    case "not_searchable":
      return `The eHVD cannot be searched for ${name || org}.`;
    case "ehvd_unreachable":
      return `The eHVD could not be reached to confirm ${name || org}.`;
    case "ehvd_error":
      return `The eHVD answered with an error, so ${name || org} could not be confirmed.`;
  }
}

/** Active, the role the document needs, and a member of the organisation, in the order the notice names them. */
function judge(type: "lab-result" | "rehab-report", person: GdaDescriptor, organisationOid: string): ReleaseHoldReason | null {
  if (!isActive(person)) return "not_active";
  if (!hasRequiredRole(type, person)) return "wrong_role";
  if (!person.relations.memberof.includes(organisationOid)) return "not_member";
  return null;
}

/** A name's parts as the document writes them, split where name words split, so "Brandl." gives "Brandl". */
const nameParts = (text: string) => text.split(/[\s.,-]+/).filter(Boolean);

type PeopleSearch = { ok: true; people: GdaDescriptor[] } | { ok: false; reason: ReleaseHoldReason };

/**
 * Everyone in the eHVD, active or not, who carries the document's name. The search asks for the family name's longest
 * part as a substring, so "Brandl-Huber" and "Huber-Brandl" both count for "Brandl", and for any given name, so
 * "Eva Maria" counts for "Eva". `Inaktiv` returns both statuses, so the notice can say that a physician is not active.
 * Only when that is more than 200 entries does it add the first given name, again as a substring, and when that is
 * still too many it holds instead of narrowing further. Every hit must carry the document's name. Spellings the eHVD
 * does not fold, such as "Mueller" for "Müller", are not found, so they are not counted either.
 */
async function searchPeople(client: EhvdClient, person: PersonLine, name: NameWords): Promise<PeopleSearch> {
  const family = nameParts(person.family).reduce((a, b) => (b.length > a.length ? b : a), "");
  const search = (query: Partial<GdaSearchQuery>) =>
    client.gdaSearch({ surname: `*${family}*`, maxResults: PERSON_RESULTS, ehvdstatus: "Inaktiv", ...query });
  const tooMany = (r: Awaited<ReturnType<typeof search>>) => !r.ok && r.failure.kind === "fault" && r.failure.code === 6005;
  let result = await search({});
  if (tooMany(result)) result = await search({ firstname: `*${nameParts(person.given)[0]}*` });
  if (tooMany(result)) return { ok: false, reason: "too_many_matches" };
  if (!result.ok) return { ok: false, reason: serviceReason(result.failure) };
  return { ok: true, people: result.value.filter((gda) => isPerson(gda) && sameName(name, entryName(gda))) };
}

export async function checkRelease(input: ReleaseInput, client: EhvdClient = ehvd): Promise<ReleaseCheck> {
  const { document, org, sender } = input;
  const person = document.type === "lab-result" ? document.validatedBy : document.writtenBy;
  let organisation: GdaDescriptor | null = null;
  const hold = (reason: ReleaseHoldReason, found: { about?: PersonLine | null; practitioner?: GdaDescriptor } = {}): ReleaseCheck => ({
    verdict: "hold",
    reason,
    sentence: sentence(reason, input, found.about === undefined ? person : found.about),
    organisation,
    practitioner: found.practitioner ?? null,
  });

  if (!person) return hold("no_responsible_person");
  const name: NameWords = { given: nameWords(person.given), family: nameWords(person.family) };
  if (name.given.size === 0 || name.family.size === 0) return hold("incomplete_name");
  if (!sameOrganisationName(document.organisation, org)) return hold("organisation_differs");

  // The name as Dr. Hofer typed it, else as the heading writes it: the eHVD matches exactly, and the two have the same
  // words in the same order but may differ in spelling, such as "Kanalstrasse" and "Kanalstraße".
  let lookup: OrganisationLookup = await findOrganisation(client, org);
  if (!lookup.ok && lookup.reason === "not_listed" && document.organisation.trim() !== org.trim()) {
    lookup = await findOrganisation(client, document.organisation);
  }
  if (!lookup.ok) return hold(ORGANISATION_HOLDS[lookup.reason], { about: null });
  organisation = lookup.organisation;
  const organisationOid = organisation.id.id;
  if (document.type === "rehab-report" && !hasCode(organisation.roles.role, GTELV_ROLE, ["300", "301"])) {
    return hold("organisation_not_hospital", { about: null });
  }
  const members = (people: GdaDescriptor[]) => people.filter((gda) => gda.relations.memberof.includes(organisationOid));

  // The responsible person is the sender, and the login carried the GDA claim: the OID links the person through the state.
  if (sender.gdaOid && sameName(name, { given: sender.givenName, family: sender.familyName })) {
    const result = await client.getGda({ id: sender.gdaOid });
    if (!result.ok) return hold(serviceReason(result.failure));
    const entry = result.value;
    if (!entry || !isPerson(entry)) return hold("claim_not_listed");
    if (entry.id.id !== sender.gdaOid || !sameName(name, entryName(entry))) return hold("claim_differs");
    const reason = judge(document.type, entry, organisationOid);
    if (reason) return hold(reason, { practitioner: entry });
    // The document's name must still point to the sender alone: another active member with it could have signed.
    const namesakes = await searchPeople(client, person, name);
    if (!namesakes.ok) return hold(namesakes.reason, { practitioner: entry });
    if (members(namesakes.people).some((gda) => isActive(gda) && gda.id.id !== entry.id.id)) return hold("several_matches");
    return { verdict: "pass", via: "claim", practitioner: entry, organisation, senderIsResponsible: true };
  }

  // Otherwise the name is the only link: exactly one active member of the organisation with that name.
  const found = await searchPeople(client, person, name);
  if (!found.ok) return hold(found.reason);
  const { people } = found;
  if (people.length === 0) return hold("not_listed");
  const atOrganisation = members(people);
  if (atOrganisation.length === 0) return hold("not_member", { practitioner: people.length === 1 ? people[0] : undefined });
  const active = atOrganisation.filter(isActive);
  if (active.length > 1) return hold("several_matches");
  if (active.length === 0) return hold("not_active", { practitioner: atOrganisation.length === 1 ? atOrganisation[0] : undefined });
  const [practitioner] = active;
  const reason = judge(document.type, practitioner, organisationOid);
  return reason ? hold(reason, { practitioner }) : { verdict: "pass", via: "search", practitioner, organisation, senderIsResponsible: false };
}
