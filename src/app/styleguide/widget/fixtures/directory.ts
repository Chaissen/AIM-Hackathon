import { isSubset, nameWords } from "@/server/identity/names";
import type { RouterOutputs } from "@/trpc/types";

import type { RouterFixtures } from "../fixture-link";

// directory.search over the scenario entries of the eHVD mock (docs/EHVD.md, "Directory content"). As against the mock,
// a query with fewer than two letters from A to Z is invalid, and one whose words are all shorter than three letters
// finds too many. The query UNAVAILABLE shows the state of an eHVD that cannot be reached.

type DirectoryEntry = Extract<RouterOutputs["directory"]["search"], { status: "ok" }>["entries"][number];

const UNAVAILABLE = "unavailable";

const LABOR = { oid: "1.2.40.0.34.3.1.99.1.2", name: "Labor Kanalstraße" };
const REHA = { oid: "1.2.40.0.34.3.1.99.1.3", name: "Reha Waldblick" };
const organisation = {
  kind: "organisation",
  given: null,
  active: true,
  specialisations: [],
  memberOf: [],
  city: "Beispielstadt",
  suggestedDocType: null,
} satisfies Partial<DirectoryEntry>;
const person = { kind: "person", active: true, mailDomain: null } satisfies Partial<DirectoryEntry>;

const ENTRIES: DirectoryEntry[] = [
  { ...organisation, oid: LABOR.oid, name: LABOR.name, family: LABOR.name, roles: ["independent outpatient clinic"], mailDomain: "labor-kanal.example" },
  { ...organisation, oid: REHA.oid, name: REHA.name, family: REHA.name, roles: ["special hospital"], mailDomain: "reha-waldblick.example" },
  {
    ...person,
    oid: "1.2.40.0.34.3.2.99.1.2",
    name: "Dr. Eva Brandl",
    given: "Eva",
    family: "Brandl",
    roles: ["specialist physician"],
    specialisations: ["medical and chemical laboratory diagnostics"],
    memberOf: [LABOR],
    city: "Beispielstadt",
    suggestedDocType: "lab-result",
  },
  {
    ...person,
    oid: "1.2.40.0.34.3.2.99.1.3",
    name: "Dr. Johanna Leitner",
    given: "Johanna",
    family: "Leitner",
    roles: ["specialist physician"],
    specialisations: ["physical medicine and general rehabilitation"],
    memberOf: [REHA],
    city: "Beispielstadt",
    suggestedDocType: "rehab-report",
  },
  {
    ...person,
    oid: "1.2.40.0.34.3.2.99.1.4",
    name: "Dr. Martin Brandl",
    given: "Martin",
    family: "Brandl",
    roles: ["general practitioner"],
    specialisations: ["general medicine"],
    memberOf: [],
    city: "Linz",
    suggestedDocType: null,
  },
  {
    ...person,
    oid: "1.2.40.0.34.3.2.99.1.5",
    name: "Dr. Eva Brandl-Huber",
    given: "Eva",
    family: "Brandl-Huber",
    active: false,
    roles: ["specialist physician"],
    specialisations: ["medical and chemical laboratory diagnostics"],
    memberOf: [],
    city: "Graz",
    suggestedDocType: "lab-result",
  },
];

const isLetter = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

export const directoryFixtures = (): RouterFixtures<"directory"> => ({
  search: ({ name }) => {
    if (name.trim().toLowerCase() === UNAVAILABLE) return { status: "unavailable" };
    if ([...name].filter(isLetter).length < 2) {
      return {
        status: "invalid",
        message: "The eHVD needs a name with at least two letters from A to Z, and allows only letters, digits, blanks, and . - ~ _ + = /.",
      };
    }
    const query = nameWords(name);
    if ([...query].every((word) => word.length < 3)) return { status: "too_many" };
    return { status: "ok", entries: ENTRIES.filter((entry) => isSubset(query, nameWords(`${entry.given ?? ""} ${entry.family}`))) };
  },
});
