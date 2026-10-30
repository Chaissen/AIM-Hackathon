import type { LabResult, PersonLine, RehabReport } from "@/server/documents/types";
import { isSubset, nameWords } from "@/server/identity/names";

import { ehvd, type EhvdClient } from "./client";
import { ELGA_ROLE, findOrganisation, GTELV_ROLE, hasCode, isActive, isPerson, SPECIALTY } from "./directory";
import type { GdaDescriptor } from "./soap";

// The release check when an answer arrives, after the patient check (docs/IDENTITY.md, "Who may release a document",
// and docs/EHVD.md, "How ordy uses the eHVD"). It never blocks: anything the eHVD does not confirm is a hold.

export type ReleaseHoldReason =
  /** The document names nobody under `Validated by` or `Written by`. */
  | "no_responsible_person"
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
  | "ehvd_unavailable";

export type ReleaseCheck =
  | { verdict: "pass"; via: "claim" | "search"; practitioner: GdaDescriptor; organisation: GdaDescriptor }
  /** `reason` for the audit log, `sentence` for the held notice (docs/ARCHITECTURE.md, "Matrix bot"). */
  | { verdict: "hold"; reason: ReleaseHoldReason; sentence: string };

export type ReleaseInput = {
  document: LabResult | RehabReport;
  /** The organisation the request went to, as Dr. Hofer typed it. */
  org: string;
  /** The person who answered, from the ID Austria login. `gdaOid` is `gdaOidFromClaim`'s OID, or null without the claim. */
  sender: { givenName: string; familyName: string; gdaOid: string | null };
};

/** Persons per name search. The service-wide maximum, so a common name does not turn into fault 6005. */
const PERSON_RESULTS = 200;

const displayName = (person: PersonLine) => [...person.titles, person.given, person.family].filter(Boolean).join(" ");

/** Every word of the document's name is in the other name, family and given name each. */
const sameName = (person: PersonLine, other: { given: string; family: string }) =>
  isSubset(nameWords(person.family), nameWords(other.family)) && isSubset(nameWords(person.given), nameWords(other.given));

const sameOrganisationName = (a: string, b: string) => {
  const [x, y] = [nameWords(a), nameWords(b)];
  return x.size === y.size && isSubset(x, y);
};

/** What the document type needs of the responsible person (docs/IDENTITY.md, "The release check"). */
const hasRequiredRole = (type: "lab-result" | "rehab-report", gda: GdaDescriptor) =>
  type === "lab-result"
    ? hasCode(gda.roles.role, GTELV_ROLE, ["158", "159"]) && hasCode(gda.roles.specialisation, SPECIALTY, ["19"])
    : hasCode(gda.roles.elgaRole, ELGA_ROLE, ["700"]);

function sentence(reason: ReleaseHoldReason, input: ReleaseInput, person: PersonLine | null): string {
  const name = person ? displayName(person) : "";
  const { org, document } = input;
  switch (reason) {
    case "no_responsible_person":
      return `The document names nobody under ${document.type === "lab-result" ? "Validated by" : "Written by"}.`;
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
    case "ehvd_unavailable":
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
  const hold = (reason: ReleaseHoldReason): ReleaseCheck => ({ verdict: "hold", reason, sentence: sentence(reason, input, person) });

  if (!person) return hold("no_responsible_person");
  if (!sameOrganisationName(document.organisation, org)) return hold("organisation_differs");

  const lookup = await findOrganisation(client, org);
  if (!lookup.ok) {
    const reason = ({ not_listed: "organisation_not_listed", several: "several_organisations", not_searchable: "not_searchable", ehvd_unavailable: "ehvd_unavailable" } as const)[lookup.reason];
    return hold(reason);
  }
  const { organisation } = lookup;
  if (document.type === "rehab-report" && !hasCode(organisation.roles.role, GTELV_ROLE, ["300", "301"])) return hold("organisation_not_hospital");

  // The responsible person is the sender, and the login carried the GDA claim: the OID links the person through the state.
  if (sender.gdaOid && sameName(person, { given: sender.givenName, family: sender.familyName })) {
    const result = await client.getGda({ id: sender.gdaOid });
    if (!result.ok) return hold(result.failure.kind === "bad_request" ? "not_searchable" : "ehvd_unavailable");
    const entry = result.value;
    if (!entry || !isPerson(entry)) return hold("not_listed");
    if (!sameName(person, { given: entry.firstname ?? "", family: entry.surname })) return hold("claim_differs");
    const reason = judge(document.type, entry, organisation.id.id);
    return reason ? hold(reason) : { verdict: "pass", via: "claim", practitioner: entry, organisation };
  }

  // Otherwise the name is the only link: exactly one active member of the organisation with that name.
  const result = await client.gdaSearch({
    ...(person.given ? { firstname: person.given } : {}),
    surname: person.family,
    maxResults: PERSON_RESULTS,
    ehvdstatus: "Aktiv",
  });
  if (!result.ok) {
    const { failure } = result;
    if (failure.kind === "bad_request") return hold("not_searchable");
    if (failure.kind === "fault" && failure.code === 6005) return hold("several_matches");
    return hold("ehvd_unavailable");
  }
  const people = result.value.filter((gda) => isPerson(gda) && isActive(gda));
  if (people.length === 0) return hold("not_listed");
  const members = people.filter((gda) => gda.relations.memberof.includes(organisation.id.id));
  if (members.length === 0) return hold("not_member");
  if (members.length > 1) return hold("several_matches");
  const reason = judge(document.type, members[0], organisation.id.id);
  return reason ? hold(reason) : { verdict: "pass", via: "search", practitioner: members[0], organisation };
}
