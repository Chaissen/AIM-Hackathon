import type { LabResult, PersonLine, RehabReport } from "@/server/documents/types";
import { isSubset, nameWords } from "@/server/identity/names";

import { ehvd, type EhvdClient } from "./client";
import { ELGA_ROLE, findOrganisation, GTELV_ROLE, hasCode, isActive, isPerson, sameOrganisationName, SPECIALTY } from "./directory";
import type { GdaDescriptor } from "./soap";

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
  | "several_organisations"
  /** A rehab report from an organisation that is not an active hospital (`role` 300 or 301). */
  | "organisation_not_hospital"
  | "not_listed"
  | "not_active"
  /** Lab: not a specialist in laboratory medicine. Rehab: not a physician. */
  | "wrong_role"
  | "not_member"
  | "several_matches"
  /** The eHVD entry for the OID in the sender's login names someone else than the document. */
  | "claim_differs"
  /** A name or organisation with characters the eHVD search does not allow. */
  | "not_searchable"
  | "ehvd_unreachable";

export type ReleaseCheck =
  | { verdict: "pass"; via: "claim" | "search"; practitioner: GdaDescriptor; organisation: GdaDescriptor }
  /** `reason` as a code, `sentence` for the held notice (docs/ARCHITECTURE.md, "Matrix bot"). */
  | { verdict: "hold"; reason: ReleaseHoldReason; sentence: string };

export type ReleaseInput = {
  document: LabResult | RehabReport;
  /** The organisation the request went to, as Dr. Hofer typed it. */
  org: string;
  /** The person who answered, from the ID Austria login. `gdaOid` is `gdaOidFromClaim`'s OID, or null without the claim. */
  sender: { givenName: string; familyName: string; gdaOid: string | null };
};

/** Persons per name search: the service-wide maximum, so only a very common family name turns into fault 6005. */
const PERSON_RESULTS = 200;

const displayName = (person: PersonLine) => [...person.titles, person.given, person.family].filter(Boolean).join(" ");

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
  const { org, document } = input;
  switch (reason) {
    case "no_responsible_person":
      return `The document names nobody under ${document.type === "lab-result" ? "Validated by" : "Written by"}.`;
    case "incomplete_name":
      return `The document does not give the full name of ${name}.`;
    case "organisation_differs":
      return `The document comes from ${document.organisation}, but the request went to ${org}.`;
    case "organisation_not_listed":
      return `The eHVD does not list ${org} as an active organisation.`;
    case "several_organisations":
      return `The eHVD lists more than one organisation named ${org}.`;
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
    case "claim_differs":
      return `The eHVD entry of the sender's ID Austria login is not ${name}.`;
    case "not_searchable":
      return `The eHVD cannot be searched for ${name || org}.`;
    case "ehvd_unreachable":
      return `The eHVD could not be reached to confirm ${name || org}.`;
  }
}

/** Active, the role the document needs, and a member of the organisation, in the order the notice names them. */
function judge(type: "lab-result" | "rehab-report", person: GdaDescriptor, organisationOid: string): ReleaseHoldReason | null {
  if (!isActive(person)) return "not_active";
  if (!hasRequiredRole(type, person)) return "wrong_role";
  if (!person.relations.memberof.includes(organisationOid)) return "not_member";
  return null;
}

export async function checkRelease(input: ReleaseInput, client: EhvdClient = ehvd): Promise<ReleaseCheck> {
  const { document, org, sender } = input;
  const person = document.type === "lab-result" ? document.validatedBy : document.writtenBy;
  const hold = (reason: ReleaseHoldReason, about: PersonLine | null = person): ReleaseCheck => ({
    verdict: "hold",
    reason,
    sentence: sentence(reason, input, about),
  });

  if (!person) return hold("no_responsible_person");
  const name: NameWords = { given: nameWords(person.given), family: nameWords(person.family) };
  if (name.given.size === 0 || name.family.size === 0) return hold("incomplete_name");
  if (!sameOrganisationName(document.organisation, org)) return hold("organisation_differs");

  const lookup = await findOrganisation(client, org);
  if (!lookup.ok) {
    const reason = ({ not_listed: "organisation_not_listed", several: "several_organisations", not_searchable: "not_searchable", ehvd_unreachable: "ehvd_unreachable" } as const)[lookup.reason];
    return hold(reason, null);
  }
  const { organisation } = lookup;
  if (document.type === "rehab-report" && !hasCode(organisation.roles.role, GTELV_ROLE, ["300", "301"])) return hold("organisation_not_hospital");

  // The responsible person is the sender, and the login carried the GDA claim: the OID links the person through the state.
  if (sender.gdaOid && sameName(name, { given: sender.givenName, family: sender.familyName })) {
    const result = await client.getGda({ id: sender.gdaOid });
    if (!result.ok) return hold(result.failure.kind === "bad_request" ? "not_searchable" : "ehvd_unreachable");
    const entry = result.value;
    if (!entry || !isPerson(entry)) return hold("not_listed");
    if (entry.id.id !== sender.gdaOid || !sameName(name, entryName(entry))) return hold("claim_differs");
    const reason = judge(document.type, entry, organisation.id.id);
    return reason ? hold(reason) : { verdict: "pass", via: "claim", practitioner: entry, organisation };
  }

  // Otherwise the name is the only link: exactly one active member of the organisation with that name. The search asks
  // for the family name only, so a given name the eHVD writes differently, such as "Johanna Maria" for "Johanna", still
  // comes back. It keeps inactive entries, so the notice can say that a physician is not active. Only a family name too
  // common for one answer (6005) adds the given name. Every hit is compared with the document's name here, so the
  // decision never rests on how the eHVD matches names.
  const search = (firstname?: string) => client.gdaSearch({ ...(firstname ? { firstname } : {}), surname: person.family, maxResults: PERSON_RESULTS });
  let result = await search();
  if (!result.ok && result.failure.kind === "fault" && result.failure.code === 6005) result = await search(person.given);
  if (!result.ok) {
    const { failure } = result;
    if (failure.kind === "bad_request") return hold("not_searchable");
    if (failure.kind === "fault" && failure.code === 6005) return hold("several_matches");
    return hold("ehvd_unreachable");
  }
  const people = result.value.filter((gda) => isPerson(gda) && sameName(name, entryName(gda)));
  if (people.length === 0) return hold("not_listed");
  const members = people.filter((gda) => gda.relations.memberof.includes(organisation.id.id));
  if (members.length === 0) return hold("not_member");
  const active = members.filter(isActive);
  if (active.length > 1) return hold("several_matches");
  // No active member: judge gives not_active for the inactive one.
  const practitioner = active[0] ?? members[0];
  const reason = judge(document.type, practitioner, organisation.id.id);
  return reason ? hold(reason) : { verdict: "pass", via: "search", practitioner, organisation };
}
