import { EHVD_AUTHORITY, RESERVED_6003, type DirectoryEntry } from "./directory.ts";
import { fold, type GetGdaRequest, type Pattern, type SearchRequest } from "./rules.ts";
import type { FaultCode, GdaDescriptor } from "./soap.ts";

export type Answer = { hits: number } & ({ gdas: GdaDescriptor[] } | { fault: FaultCode });

function toDescriptor(entry: DirectoryEntry): GdaDescriptor | undefined {
  const [description, ...more] = entry.description ?? [];
  if (description === undefined || entry.timestamps === undefined) return undefined;
  return {
    id: { oidIssuingAuthority: EHVD_AUTHORITY, id: entry.oid },
    otherID: (entry.otherIds ?? []).map(({ kind, number }) => `${kind}:${number}`),
    status: entry.status,
    firstname: entry.firstname,
    surname: entry.surname,
    gender: entry.gender,
    title: entry.title,
    knownname: entry.knownname ?? [],
    address: entry.address ?? [],
    description: [description, ...more],
    roles: entry.roles,
    relations: entry.relations,
    tel: entry.tel,
    fax: entry.fax,
    web: entry.web,
    mail: entry.mail,
    timestamps: entry.timestamps,
  };
}

function answer(entries: readonly DirectoryEntry[]): Answer {
  const gdas: GdaDescriptor[] = [];
  for (const entry of entries) {
    const gda = toDescriptor(entry);
    if (!gda) return { hits: entries.length, fault: 6004 };
    gdas.push(gda);
  }
  return { hits: entries.length, gdas };
}

export function getGda(directory: readonly DirectoryEntry[], { oidIssuingAuthority, id }: GetGdaRequest): Answer {
  if (oidIssuingAuthority === undefined || oidIssuingAuthority === EHVD_AUTHORITY) {
    if (id === RESERVED_6003) return { hits: 0, fault: 6003 };
    const entry = directory.find((candidate) => candidate.oid === id);
    return entry ? answer([entry]) : { hits: 0, fault: 6002 };
  }
  const entry = directory.find((candidate) =>
    candidate.otherIds?.some(({ kind, number }) => kind === oidIssuingAuthority && fold(number) === id),
  );
  return entry ? answer([entry]) : { hits: 0, fault: 6002 };
}

function matches({ match, text }: Pattern, value: string) {
  const folded = fold(value);
  switch (match) {
    case "exact":
      return folded === text;
    case "prefix":
      return folded.startsWith(text);
    case "suffix":
      return folded.endsWith(text);
    case "contains":
      return folded.includes(text);
  }
}

const code = (coded: string) => coded.slice(coded.lastIndexOf(":") + 1);

function found(entry: DirectoryEntry, request: SearchRequest) {
  const { firstname, description, rolecode, address, activeOnly } = request;
  return (
    matches(request.surname, entry.surname) &&
    (!firstname || (entry.firstname !== undefined && matches(firstname, entry.firstname))) &&
    (!description || (entry.description ?? []).some((value) => matches(description, value))) &&
    (rolecode === undefined || [...entry.roles.role, ...entry.roles.elgaRole].some((role) => fold(code(role)) === rolecode)) &&
    (address.length === 0 ||
      (entry.address ?? []).some((candidate) => address.every(({ field, value }) => fold(candidate[field] ?? "") === value))) &&
    (!activeOnly.ehvdstatus || entry.status.ehvdstatus === "Aktiv") &&
    (!activeOnly.elgastatus || entry.status.elgastatus === "Aktiv")
  );
}

export function gdaSearch(directory: readonly DirectoryEntry[], request: SearchRequest): Answer {
  const hits = directory.filter((entry) => !entry.getGdaOnly && found(entry, request));
  return hits.length > request.maxResults ? { hits: hits.length, fault: 6005 } : answer(hits);
}
