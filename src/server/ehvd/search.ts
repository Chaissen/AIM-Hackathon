import { env } from "@/env";
import type { DocumentType } from "@/lib/document-types";
import { isSubset, nameWords } from "@/server/identity/names";

import { ehvd, type EhvdClient } from "./client";
import { GTELV_ROLE, hasCode, isActive, isOrganisation, isPerson, sameOrganisationName, SPECIALTY } from "./directory";
import { codeLabels } from "./labels";
import type { GdaDescriptor } from "./soap";

// The directory search in the widget's Contacts view (docs/EHVD.md, "How ordy uses the eHVD"). The listed entries in
// listing.ts share the entry shape.

export type DirectoryEntry = {
  oid: string;
  kind: "person" | "organisation";
  /** "Dr. Eva Brandl" or "Labor Kanalstraße" */
  name: string;
  /** "Dr.", or null for an organisation and a person without a title */
  title: string | null;
  /** For the New request prefill */
  given: string | null;
  family: string;
  active: boolean;
  roles: string[];
  specialisations: string[];
  /** `name` is null when the eHVD did not give it: a search looks up at most MEMBER_LOOKUPS organisations. */
  memberOf: { oid: string; name: string | null }[];
  mailDomain: string | null;
  city: string | null;
  /** The lab medicine specialty suggests a lab result, membership of a hospital (role 300 or 301) a rehab report. */
  suggestedDocType: DocumentType | null;
  /**
   * The organisation named CLINIC_NAME, or a person who is a member of it. They are inside the closed network, so the
   * widget offers no request to them; that covers the signed-in doctor, whose Matrix ID has no eHVD OID.
   */
  inNetwork: boolean;
};

export type DirectorySearch =
  | { status: "ok"; entries: DirectoryEntry[] }
  /** More hits than MAX_RESULTS, fault 6005 */
  | { status: "too_many" }
  /** The eHVD cannot be searched for the name, such as one with fewer than two letters from A to Z */
  | { status: "invalid"; message: string }
  /** Unreachable, another fault, or an answer the WSDL does not describe */
  | { status: "unavailable" };

const MAX_RESULTS = 50;
/** Parts of one query searched at most, one after the other */
const MAX_SEARCHES = 3;
const MEMBER_LOOKUPS = 10;
const INVALID = {
  status: "invalid",
  message: "The eHVD needs a name with at least two letters from A to Z, and allows only letters, digits, blanks, and . - ~ _ + = /.",
} as const;

// Where name words split (src/server/identity/names.ts), so a part keeps the spelling the eHVD compares.
const SEPARATORS = new Set([" ", "\t", "\n", "\r", ".", ",", "-"]);
const parts = (query: string) =>
  [...query]
    .map((c) => (SEPARATORS.has(c) ? " " : c))
    .join("")
    .split(" ")
    .filter(Boolean);

const fullName = (gda: GdaDescriptor) => [gda.title, gda.firstname, gda.surname].filter(Boolean).join(" ");

/** The part after the only `@`, or null. */
function mailDomain(mail: string | undefined): string | null {
  const [local, domain, ...more] = (mail ?? "").split("@");
  return local && domain && more.length === 0 ? domain : null;
}

function suggestedDocType(gda: GdaDescriptor, organisations: Map<string, GdaDescriptor>): DocumentType | null {
  if (!isPerson(gda)) return null;
  if (hasCode(gda.roles.specialisation, SPECIALTY, ["19"])) return "lab-result";
  const hospital = (oid: string) => {
    const organisation = organisations.get(oid);
    return organisation !== undefined && hasCode(organisation.roles.role, GTELV_ROLE, ["300", "301"]);
  };
  return gda.relations.memberof.some(hospital) ? "rehab-report" : null;
}

/**
 * The entries with their organisations' names, looking up at most MEMBER_LOOKUPS organisations not among the hits.
 * `clinic` is the name of the organisation that runs ordy, for `inNetwork`.
 */
export async function toEntries(
  found: GdaDescriptor[],
  hits: GdaDescriptor[],
  client: EhvdClient,
  clinic: string = env.CLINIC_NAME,
): Promise<DirectoryEntry[]> {
  const organisations = new Map(hits.map((gda) => [gda.id.id, gda]));
  const lookups = [...new Set(found.flatMap((gda) => gda.relations.memberof))].filter((oid) => !organisations.has(oid)).slice(0, MEMBER_LOOKUPS);
  const looked = await Promise.all(lookups.map((id) => client.getGda({ id })));
  looked.forEach((lookup, i) => {
    if (lookup.ok && lookup.value) organisations.set(lookups[i], lookup.value);
  });
  const isClinic = (gda: GdaDescriptor | undefined) => gda !== undefined && isOrganisation(gda) && sameOrganisationName(gda.surname, clinic);

  return found.map((gda) => ({
    oid: gda.id.id,
    kind: isPerson(gda) ? "person" : "organisation",
    name: fullName(gda),
    title: gda.title ?? null,
    given: gda.firstname ?? null,
    family: gda.surname,
    active: isActive(gda),
    roles: codeLabels(gda.roles.role),
    specialisations: codeLabels(gda.roles.specialisation),
    memberOf: gda.relations.memberof.map((oid) => {
      const organisation = organisations.get(oid);
      return { oid, name: organisation ? fullName(organisation) : null };
    }),
    mailDomain: mailDomain(gda.mail),
    city: gda.address[0]?.city ?? null,
    suggestedDocType: suggestedDocType(gda, organisations),
    inNetwork: isClinic(gda) || (isPerson(gda) && gda.relations.memberof.some((oid) => isClinic(organisations.get(oid)))),
  }));
}

/**
 * Every entry, active or not, whose name has every word of the query. The eHVD searches one part of the query as a
 * substring of the surname, so "Eva Brandl" finds Eva Brandl-Huber too, and the name words narrow the hits down. The
 * longest part goes first, the later one on a tie, since a family name usually comes last. When its hits have no entry
 * with every word, such as for "Christina Eder", where `*Christina*` finds no surname, the next part is searched.
 */
export async function searchDirectory(query: string, client: EhvdClient = ehvd): Promise<DirectorySearch> {
  const words = nameWords(query);
  const candidates = [...new Set(parts(query).filter((part) => isSubset(nameWords(part), words)))].reverse().sort((a, b) => b.length - a.length);
  if (candidates.length === 0) return INVALID;

  for (const part of candidates.slice(0, MAX_SEARCHES)) {
    const result = await client.gdaSearch({ surname: `*${part}*`, maxResults: MAX_RESULTS, ehvdstatus: "Inaktiv" });
    if (!result.ok) {
      const { failure } = result;
      if (failure.kind === "fault" && failure.code === 6005) return { status: "too_many" };
      return failure.kind === "bad_request" ? INVALID : { status: "unavailable" };
    }
    const found = result.value.filter((gda) => isSubset(words, nameWords([gda.firstname, gda.surname].filter(Boolean).join(" "))));
    if (found.length > 0) return { status: "ok", entries: await toEntries(found, result.value, client) };
  }
  return { status: "ok", entries: [] };
}
