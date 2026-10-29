import { randomUUID } from "node:crypto";

import type { Bundle, BundleEntry, FhirResource, Organization, Practitioner, Provenance, ProvenanceAgent, Reference, Task } from "fhir/r4";
import { decodeJwt } from "jose";

import type { DocumentType } from "@/lib/document-types";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { viennaInstant } from "@/server/documents/dates";

// The filing of one answer (docs/FHIR.md, "Provenance", "Task", "Practitioner and Organization").
// Everything here is pure: it builds one transaction Bundle, so the answer is filed completely or not at all.
// `file-answer.ts` posts it and writes the audit entry.

/** A resource with the `urn:uuid:` fullUrl it gets in the Bundle. The mappers (T12, T14) return this shape. */
export type FilingEntry = { fullUrl: string; resource: FhirResource };

/** A person as the request and ID Austria name them. */
export type Person = {
  /** All given names, for example `Eva` or `Eva Maria`. */
  given: string;
  family: string;
  /** Academic titles, for example `["Dr."]`. */
  titles?: string[];
  /** The eHVD OID, for example `1.2.40.0.34.3.2.99.1.2`. Null when the eHVD does not list the person. */
  ehvdOid: string | null;
  /** For a person without an eHVD entry: the Practitioner id the `bindings` table remembers from an earlier answer. */
  practitionerId?: string | null;
};

export type OrganizationParty = { name: string; ehvdOid: string | null };

/** The identity provider that signed the ID token. Its issuer URL identifies it across filings. */
export type IdentityProvider = { name: string; issuer: string };

export const ID_AUSTRIA_SIMULATION = "ID Austria (simulation)";

export type Parties = {
  /** Dr. Hofer, who sent the request. */
  requester: Person;
  /** The outside person who logged in with ID Austria and sent the answer. */
  sender: Person;
  /** The person responsible for the content (`Validated by`, `Written by`). Null when that is the sender. */
  author: Person | null;
  /** The outside organisation the author answers for. */
  organization: OrganizationParty;
  identityProvider: IdentityProvider;
};

/** References the mappers and the Provenance point at, and the Bundle entries that create them. */
export type PreparedParties = {
  requester: Reference;
  sender: Reference;
  /** The author's reference, or the sender's when the sender is the author. Pass it to the mapper as `practitioner`. */
  author: Reference;
  organization: Reference;
  identityProvider: Reference;
  /** True when the author is someone other than the sender, so the Provenance names the sender as informant. */
  hasInformant: boolean;
  entries: BundleEntry[];
};

const RFC3986 = "urn:ietf:rfc:3986";
const urn = () => `urn:uuid:${randomUUID()}`;

const oidIdentifier = (oid: string) => ({ system: RFC3986, value: `urn:oid:${oid}` });

/**
 * A POST entry. With an identifier, the entry is a conditional create (`ifNoneExist`), so a second answer from
 * the same person or organisation reuses the resource instead of creating a copy.
 */
function create(resource: Practitioner | Organization, identifier: { system: string; value: string } | null): { reference: Reference; entry: BundleEntry } {
  const fullUrl = urn();
  const withIdentifier: Practitioner | Organization = identifier ? { ...resource, identifier: [identifier] } : resource;
  return {
    reference: { reference: fullUrl },
    entry: {
      fullUrl,
      resource: withIdentifier,
      request: {
        method: "POST",
        url: resource.resourceType,
        ...(identifier && { ifNoneExist: `identifier=${identifier.system}|${identifier.value}` }),
      },
    },
  };
}

const givenNames = (given: string) => given.trim().split(/\s+/).filter(Boolean);

export const displayName = (person: Person) => [...(person.titles ?? []), ...givenNames(person.given), person.family].join(" ");

function practitioner(person: Person) {
  if (!person.ehvdOid && person.practitionerId) return { reference: { reference: `Practitioner/${person.practitionerId}` }, entry: null };
  // No birth date: we never store the outside person's birth date (docs/FHIR.md).
  const resource: Practitioner = {
    resourceType: "Practitioner",
    name: [{ family: person.family, given: givenNames(person.given), ...(person.titles?.length ? { prefix: person.titles } : {}) }],
  };
  return create(resource, person.ehvdOid ? oidIdentifier(person.ehvdOid) : null);
}

/** Builds the Practitioner and Organization entries. Call it before the mapper, which needs the references. */
export function prepareParties(parties: Parties): PreparedParties {
  const requester = practitioner(parties.requester);
  const sender = practitioner(parties.sender);
  const author = parties.author ? practitioner(parties.author) : sender;
  const organization = create(
    { resourceType: "Organization", name: parties.organization.name },
    parties.organization.ehvdOid ? oidIdentifier(parties.organization.ehvdOid) : null,
  );
  const identityProvider = create(
    { resourceType: "Organization", name: parties.identityProvider.name },
    { system: RFC3986, value: parties.identityProvider.issuer },
  );
  const slots = [requester, sender, ...(parties.author ? [author] : []), organization, identityProvider];
  return {
    requester: requester.reference,
    sender: sender.reference,
    author: author.reference,
    organization: organization.reference,
    identityProvider: identityProvider.reference,
    hasInformant: parties.author !== null,
    entries: slots.flatMap((slot) => (slot.entry ? [slot.entry] : [])),
  };
}

// Task mirrors the request state (docs/ARCHITECTURE.md, "Request lifecycle").
export const TASK_STATUS = {
  awaiting_confirmation: "draft",
  sent: "requested",
  identity_held: "on-hold",
  verified: "in-progress",
  answer_held: "on-hold",
  filed: "completed",
  cancelled: "cancelled",
  expired: "failed",
  locked: "failed",
} as const satisfies Record<string, Task["status"]>;

export type RequestState = keyof typeof TASK_STATUS;

/** The Task id is fixed per request, so every state change and the filing PUT the same Task. */
export const taskId = (requestId: number) => `ordy-request-${requestId}`;

export type TaskInput = {
  requestId: number;
  docType: DocumentType;
  state: RequestState;
  /** Details such as "waiting for a new upload after a patient mismatch". */
  businessStatus?: string;
  patient: Reference;
  createdAt: Date;
  expiresAt: Date;
  requester: Reference;
  /** The outside person's Practitioner. Before the filing, a reference with only `display` is enough. */
  owner: Reference;
  /** The DiagnosticReport or DocumentReference, once filed. */
  output?: Reference;
};

export function buildTask(input: TaskInput): Task & { id: string } {
  const type = DOCUMENT_TYPES[input.docType];
  return {
    resourceType: "Task",
    id: taskId(input.requestId),
    status: TASK_STATUS[input.state],
    ...(input.businessStatus && { businessStatus: { text: input.businessStatus } }),
    intent: "order",
    description: `Request for a ${type.messageName}`,
    for: input.patient,
    authoredOn: viennaInstant(input.createdAt),
    requester: input.requester,
    owner: input.owner,
    restriction: { period: { end: viennaInstant(input.expiresAt) } },
    ...(input.output && { output: [{ type: { text: type.label }, valueReference: input.output }] }),
  };
}

const POLICY = "urn:aim-t2:identity-policy";
export const identityPolicy = (docType: DocumentType) => `${POLICY}:${docType}:v1`;
export const ACCEPTED_BY_REQUESTER_POLICY = `${POLICY}:accepted-by-requester:v1`;

const participant = (code: "author" | "informant", who: Reference, onBehalfOf: Reference): ProvenanceAgent => ({
  type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code }] },
  who,
  onBehalfOf,
});

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const viennaDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", day: "numeric", month: "long", year: "numeric" });
const viennaTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const LEVELS: Record<string, string> = { "urn:eidgvat:eid.status.full": "full function", "urn:eidgvat:eid.status.basic": "basic function" };

/** The login time and the levels from the ID token. The token was verified at login, so we only decode it here. */
function readIdToken(idToken: string) {
  const claims = decodeJwt(idToken);
  const loginAt = typeof claims.auth_time === "number" ? claims.auth_time : claims.iat;
  if (typeof loginAt !== "number") throw new Error("The ID token has neither auth_time nor iat");
  const level = LEVELS[String(claims["urn:pvpgvat:oidc.eid_ida_level"])];
  const loa = claims["urn:pvpgvat:oidc.eid_citizen_qaa_eidas_level"];
  // `http://eidas.europa.eu/LoA/high` becomes "level high".
  const assurance = typeof loa === "string" ? `level ${loa.split("/").pop()}` : undefined;
  return { loginAt: new Date(loginAt * 1000), levels: [level, assurance].filter(Boolean).join(", ") };
}

export type AnswerFiling = {
  request: { id: number; docType: DocumentType; patient: Reference; createdAt: Date; expiresAt: Date };
  /** The names as written into the narrative. */
  parties: Parties;
  prepared: PreparedParties;
  /** The mapper output: the DiagnosticReport or DocumentReference, and the Observations if any. */
  clinical: { output: FilingEntry; others: FilingEntry[] };
  /** The ID token exactly as received from ID Austria. */
  idToken: string;
  /** When the outside person pressed send. */
  sentAt: Date;
  /** When the request service files the answer. */
  filedAt: Date;
  /** True when Dr. Hofer accepted a held answer. */
  acceptedByRequester: boolean;
  /** Extra sentences for the Provenance narrative, for example the outcome of the release check. */
  findings?: string[];
};

/** Reference strings for the audit entry. Before the POST they are `urn:uuid:`, afterwards `resolveIds` maps them. */
export type FilingRefs = {
  output: string;
  targets: string[];
  provenance: string;
  task: string;
  sender: string;
  author: string;
  organization: string;
};

export type Filing = { bundle: Bundle; refs: FilingRefs };

function narrative(filing: AnswerFiling, levels: string): string {
  const { parties, sentAt } = filing;
  const sentences = [
    `Sent by ${displayName(parties.sender)} on ${viennaDay.format(sentAt)} at ${viennaTime.format(sentAt)}.`,
    ...(parties.author ? [`Written by ${displayName(parties.author)} for ${parties.organization.name}.`] : []),
    `Identity checked with ${parties.identityProvider.name}${levels ? `, ${levels}` : ""}.`,
    ...(filing.acceptedByRequester ? [`${displayName(parties.requester)} accepted the held answer.`] : []),
    ...(filing.findings ?? []),
  ];
  return `<div xmlns="http://www.w3.org/1999/xhtml">${escapeHtml(sentences.join(" "))}</div>`;
}

const ref = (reference: Reference) => reference.reference ?? "";

/** One transaction Bundle per answer: parties, clinical resources, Provenance, and the completed Task. */
export function buildFilingBundle(filing: AnswerFiling): Filing {
  const { prepared, clinical, request } = filing;
  const { loginAt, levels } = readIdToken(filing.idToken);
  const clinicalEntries = [clinical.output, ...clinical.others];
  const targets = clinicalEntries.map((entry) => entry.fullUrl);

  const provenanceUrl = urn();
  const provenance: Provenance = {
    resourceType: "Provenance",
    text: { status: "generated", div: narrative(filing, levels) },
    target: targets.map((reference) => ({ reference })),
    occurredDateTime: viennaInstant(filing.sentAt),
    recorded: viennaInstant(filing.filedAt),
    policy: [identityPolicy(request.docType), ...(filing.acceptedByRequester ? [ACCEPTED_BY_REQUESTER_POLICY] : [])],
    agent: [
      participant("author", prepared.author, prepared.organization),
      ...(prepared.hasInformant ? [participant("informant", prepared.sender, prepared.organization)] : []),
    ],
    signature: [
      {
        type: [{ system: "urn:iso-astm:E1762-95:2013", code: "1.2.840.10065.1.12.1.10" }],
        when: viennaInstant(loginAt),
        who: prepared.identityProvider,
        sigFormat: "application/jose",
        data: Buffer.from(filing.idToken, "utf8").toString("base64"),
      },
    ],
  };

  const task = buildTask({
    requestId: request.id,
    docType: request.docType,
    state: "filed",
    patient: request.patient,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    requester: prepared.requester,
    owner: prepared.sender,
    output: { reference: clinical.output.fullUrl },
  });

  const bundle: Bundle = {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...prepared.entries,
      ...clinicalEntries.map(({ fullUrl, resource }) => ({ fullUrl, resource, request: { method: "POST" as const, url: resource.resourceType } })),
      { fullUrl: provenanceUrl, resource: provenance, request: { method: "POST", url: "Provenance" } },
      // PUT, so the Task the request created earlier is updated, or created if it does not exist yet.
      { resource: task, request: { method: "PUT", url: `Task/${task.id}` } },
    ],
  };

  return {
    bundle,
    refs: {
      output: clinical.output.fullUrl,
      targets,
      provenance: provenanceUrl,
      task: `Task/${task.id}`,
      sender: ref(prepared.sender),
      author: ref(prepared.author),
      organization: ref(prepared.organization),
    },
  };
}

/** `Practitioner/12/_history/1`, absolute or relative, becomes `Practitioner/12`. */
export const locationId = (location: string | undefined) => location?.match(/([A-Za-z]+\/[A-Za-z0-9\-.]+)(?:\/_history\/[^/]+)?$/)?.[1];

/**
 * Maps every `urn:uuid:` of the request Bundle to the server id from the transaction-response, for example
 * `Practitioner/12`. Responses come in the order of the request entries. References that are already server ids stay.
 */
export function resolveIds(request: Bundle, response: Bundle): (reference: string) => string {
  const ids = new Map<string, string>();
  request.entry?.forEach((entry, index) => {
    const id = locationId(response.entry?.[index]?.response?.location);
    if (entry.fullUrl && id) ids.set(entry.fullUrl, id);
  });
  return (reference) => {
    const id = reference.startsWith("urn:uuid:") ? ids.get(reference) : reference;
    if (!id) throw new Error(`The transaction response has no id for ${reference}`);
    return id;
  };
}
