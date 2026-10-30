import assert from "node:assert/strict";
import { test } from "node:test";

import type { Bundle, BundleEntry, DiagnosticReport, DocumentReference, Identifier, Observation, Organization, Practitioner, Provenance, Reference, Resource, Task } from "fhir/r4";

import { viennaInstant } from "@/server/documents/dates";

import { fileAnswer, type AnswerFiled } from "./file-answer";
import {
  ACCEPTED_BY_REQUESTER_POLICY,
  buildFilingBundle,
  buildTask,
  ID_AUSTRIA_SIMULATION,
  prepareParties,
  type AnswerFiling,
  type FilingEntry,
  type Parties,
} from "./filing";

const ISSUER = "http://localhost:8080/realms/idaustria-sim";
const LAB_SHA = "a".repeat(64);
const REHAB_SHA = "b".repeat(64);

// The filing only decodes the token; the login verified it. So an unsigned token is enough here.
function idToken(claims: Record<string, unknown>) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part({ iss: ISSUER, ...claims })}.c2lnbmF0dXJl`;
}

const EVA_TOKEN = idToken({
  given_name: "Eva",
  family_name: "Brandl",
  iat: Date.parse("2026-10-29T13:01:40Z") / 1000,
  "urn:pvpgvat:oidc.eid_ida_level": "urn:eidgvat:eid.status.full",
  "urn:pvpgvat:oidc.eid_citizen_qaa_eidas_level": "http://eidas.europa.eu/LoA/high",
});

const hofer = { given: "Lena", family: "Hofer", titles: ["Dr."], ehvdOid: "1.2.40.0.34.3.2.99.1.1" };
const idAustria = { name: ID_AUSTRIA_SIMULATION, issuer: ISSUER };

const labParties: Parties = {
  requester: hofer,
  sender: { given: "Eva", family: "Brandl", titles: ["Dr."], ehvdOid: "1.2.40.0.34.3.2.99.1.2" },
  author: null,
  organization: { name: "Labor Kanalstraße", ehvdOid: "1.2.40.0.34.3.1.99.1.2" },
  identityProvider: idAustria,
};

const rehabParties: Parties = {
  requester: hofer,
  sender: { given: "Stefan", family: "Kern", ehvdOid: null },
  author: { given: "Johanna", family: "Leitner", titles: ["Dr."], ehvdOid: "1.2.40.0.34.3.2.99.1.3" },
  organization: { name: "Reha Waldblick", ehvdOid: "1.2.40.0.34.3.1.99.1.3" },
  identityProvider: idAustria,
};

const patient = { reference: "Patient/maria-beispiel" };

// Stand-ins for the mapper output (T12, T14): only the shape matters to the filing.
function labClinical(practitioner: { reference?: string }) {
  const observations: FilingEntry[] = ["6301-6", "14979-9"].map((code) => ({
    fullUrl: `urn:uuid:observation-${code}`,
    resource: { resourceType: "Observation", status: "final", code: { coding: [{ system: "http://loinc.org", code }] }, subject: patient, performer: [practitioner] } satisfies Observation,
  }));
  const output: FilingEntry = {
    fullUrl: "urn:uuid:diagnostic-report",
    resource: {
      resourceType: "DiagnosticReport",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "11502-2" }] },
      subject: patient,
      result: observations.map(({ fullUrl }) => ({ reference: fullUrl })),
    } satisfies DiagnosticReport,
  };
  return { output, others: observations };
}

const rehabClinical = () => ({
  output: {
    fullUrl: "urn:uuid:document-reference",
    resource: { resourceType: "DocumentReference", status: "current", subject: patient, content: [{ attachment: { contentType: "text/markdown" } }] } satisfies DocumentReference,
  },
  others: [],
});

const request = (id: number, docType: "lab-result" | "rehab-report") => ({
  id,
  docType,
  patient,
  createdAt: new Date("2026-10-29T12:30:00Z"),
  expiresAt: new Date("2026-11-05T12:30:00Z"),
});

function labFiling(overrides: Partial<AnswerFiling> = {}, uploadSha256 = LAB_SHA): AnswerFiling {
  const prepared = prepareParties(labParties, { requestId: 1, uploadSha256 });
  return {
    request: request(1, "lab-result"),
    parties: labParties,
    prepared,
    clinical: labClinical(prepared.author),
    idToken: EVA_TOKEN,
    sentAt: new Date("2026-10-29T13:02:10Z"),
    filedAt: new Date("2026-10-29T13:02:12Z"),
    acceptedByRequester: false,
    ...overrides,
  };
}

function rehabFiling(): AnswerFiling {
  const prepared = prepareParties(rehabParties, { requestId: 2, uploadSha256: REHAB_SHA });
  return {
    request: request(2, "rehab-report"),
    parties: rehabParties,
    prepared,
    clinical: rehabClinical(),
    idToken: idToken({ iat: Date.parse("2026-10-29T13:10:00Z") / 1000, "urn:pvpgvat:oidc.eid_ida_level": "urn:eidgvat:eid.status.full" }),
    sentAt: new Date("2026-10-29T13:11:00Z"),
    filedAt: new Date("2026-10-29T13:11:01Z"),
    acceptedByRequester: false,
  };
}

const byType = <T>(bundle: Bundle, type: string) => (bundle.entry ?? []).filter((e) => e.resource?.resourceType === type) as (BundleEntry & { resource: T })[];
const only = <T>(bundle: Bundle, type: string) => {
  const entries = byType<T>(bundle, type);
  assert.equal(entries.length, 1, `one ${type}`);
  return entries[0];
};

test("viennaInstant writes seconds and the Vienna offset on both sides of the clock change", () => {
  assert.equal(viennaInstant(new Date("2026-10-29T13:02:12Z")), "2026-10-29T14:02:12+01:00");
  assert.equal(viennaInstant(new Date("2026-10-22T06:10:00Z")), "2026-10-22T08:10:00+02:00");
  assert.equal(viennaInstant(new Date("2026-12-31T23:30:05Z")), "2027-01-01T00:30:05+01:00");
});

test("request 1: one transaction with conditional creates on the eHVD OIDs", () => {
  const { bundle } = buildFilingBundle(labFiling());
  assert.equal(bundle.type, "transaction");

  const practitioners = byType<Practitioner>(bundle, "Practitioner");
  assert.deepEqual(
    practitioners.map((e) => [e.resource.name?.[0], e.request]),
    [
      [{ family: "Hofer", given: ["Lena"], prefix: ["Dr."] }, { method: "POST", url: "Practitioner", ifNoneExist: "identifier=urn:ietf:rfc:3986|urn:oid:1.2.40.0.34.3.2.99.1.1" }],
      [{ family: "Brandl", given: ["Eva"], prefix: ["Dr."] }, { method: "POST", url: "Practitioner", ifNoneExist: "identifier=urn:ietf:rfc:3986|urn:oid:1.2.40.0.34.3.2.99.1.2" }],
    ],
  );
  assert.deepEqual(practitioners[1].resource.identifier, [{ system: "urn:ietf:rfc:3986", value: "urn:oid:1.2.40.0.34.3.2.99.1.2" }]);

  const organizations = byType<Organization>(bundle, "Organization");
  assert.deepEqual(
    organizations.map((e) => [e.resource.name, e.request?.ifNoneExist]),
    [
      ["Labor Kanalstraße", "identifier=urn:ietf:rfc:3986|urn:oid:1.2.40.0.34.3.1.99.1.2"],
      [ID_AUSTRIA_SIMULATION, `identifier=urn:ietf:rfc:3986|${ISSUER}`],
    ],
  );

  // Every entry with a fullUrl is a urn:uuid, so HAPI rewrites the references to it.
  for (const entry of bundle.entry ?? []) if (entry.fullUrl) assert.match(entry.fullUrl, /^urn:uuid:/);
  assert.deepEqual(
    byType<Observation>(bundle, "Observation").map((e) => e.request),
    [
      { method: "POST", url: "Observation", ifNoneExist: `identifier=urn:aim-t2:answer|1:${LAB_SHA}:result-1` },
      { method: "POST", url: "Observation", ifNoneExist: `identifier=urn:aim-t2:answer|1:${LAB_SHA}:result-2` },
    ],
  );
  const report = only<DiagnosticReport>(bundle, "DiagnosticReport");
  assert.deepEqual(report.resource.identifier, [{ system: "urn:aim-t2:answer", value: `1:${LAB_SHA}:output` }]);
  assert.deepEqual(report.request, { method: "POST", url: "DiagnosticReport", ifNoneExist: `identifier=urn:aim-t2:answer|1:${LAB_SHA}:output` });
  assert.deepEqual(only<Provenance>(bundle, "Provenance").request, { method: "POST", url: "Provenance", ifNoneExist: "target=urn:uuid:diagnostic-report" });
});

test("request 1: Provenance names the author, the policy, and the ID token as signature", () => {
  const filing = labFiling();
  const { bundle } = buildFilingBundle(filing);
  const { resource: provenance } = only<Provenance>(bundle, "Provenance");
  const brandl = filing.prepared.sender.reference;
  const labor = filing.prepared.organization.reference;

  assert.deepEqual(
    provenance.target.map((t) => t.reference),
    ["urn:uuid:diagnostic-report", "urn:uuid:observation-6301-6", "urn:uuid:observation-14979-9"],
  );
  assert.equal(provenance.occurredDateTime, "2026-10-29T14:02:10+01:00");
  assert.equal(provenance.recorded, "2026-10-29T14:02:12+01:00");
  assert.deepEqual(provenance.policy, ["urn:aim-t2:identity-policy:lab-result:v1"]);
  assert.deepEqual(provenance.agent, [
    {
      type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "author" }] },
      who: { reference: brandl },
      onBehalfOf: { reference: labor },
    },
  ]);
  assert.deepEqual(provenance.signature, [
    {
      type: [{ system: "urn:iso-astm:E1762-95:2013", code: "1.2.840.10065.1.12.1.10" }],
      when: "2026-10-29T14:01:40+01:00",
      who: filing.prepared.identityProvider,
      sigFormat: "application/jose",
      data: Buffer.from(EVA_TOKEN).toString("base64"),
    },
  ]);
  assert.equal(
    provenance.text?.div,
    '<div xmlns="http://www.w3.org/1999/xhtml">Sent by Dr. Eva Brandl on 29 October 2026 at 14:02. Identity checked with ID Austria (simulation), full function, level high.</div>',
  );
});

test("request 1: the Task is completed and points at the DiagnosticReport", () => {
  const filing = labFiling();
  const { bundle, refs } = buildFilingBundle(filing);
  const entry = only<Task>(bundle, "Task");
  assert.deepEqual(entry.request, { method: "PUT", url: "Task/ordy-request-1" });
  assert.equal(refs.task, "Task/ordy-request-1");
  assert.deepEqual(entry.resource, {
    resourceType: "Task",
    id: "ordy-request-1",
    status: "completed",
    intent: "order",
    description: "Request for a lab result",
    for: patient,
    authoredOn: "2026-10-29T13:30:00+01:00",
    requester: filing.prepared.requester,
    owner: filing.prepared.sender,
    restriction: { period: { end: "2026-11-05T13:30:00+01:00" } },
    output: [{ type: { text: "Lab result" }, valueReference: { reference: "urn:uuid:diagnostic-report" } }],
  });
});

test("request 2: Dr. Leitner is the author, Stefan Kern the informant without an eHVD entry", () => {
  const filing = rehabFiling();
  const { bundle } = buildFilingBundle(filing);

  const kern = byType<Practitioner>(bundle, "Practitioner").find((e) => e.resource.name?.[0]?.family === "Kern");
  assert.ok(kern);
  // No eHVD entry, so the identifier comes from the answer: a retry reuses him, a later answer does not.
  const kernIdentifier = { system: "urn:aim-t2:answer", value: `2:${REHAB_SHA}:sender` };
  assert.deepEqual(kern.request, { method: "POST", url: "Practitioner", ifNoneExist: `identifier=urn:aim-t2:answer|2:${REHAB_SHA}:sender` });
  assert.deepEqual(kern.resource.identifier, [kernIdentifier]);
  assert.equal(kern.resource.name?.[0]?.prefix, undefined);

  const { resource: provenance } = only<Provenance>(bundle, "Provenance");
  assert.deepEqual(
    provenance.agent.map((a) => [a.type?.coding?.[0]?.code, a.who.reference, a.onBehalfOf?.reference]),
    [
      ["author", filing.prepared.author.reference, filing.prepared.organization.reference],
      ["informant", filing.prepared.sender.reference, filing.prepared.organization.reference],
    ],
  );
  assert.notEqual(filing.prepared.author.reference, filing.prepared.sender.reference);
  assert.deepEqual(provenance.policy, ["urn:aim-t2:identity-policy:rehab-report:v1"]);
  assert.deepEqual(provenance.target, [{ reference: "urn:uuid:document-reference" }]);
  assert.match(provenance.text?.div ?? "", /Sent by Stefan Kern on 29 October 2026 at 14:11\. Written by Dr\. Johanna Leitner for Reha Waldblick\. Identity checked with ID Austria \(simulation\), full function\./);

  const { resource: task } = only<Task>(bundle, "Task");
  assert.equal(task.description, "Request for a rehab discharge report");
  assert.equal(task.owner?.reference, filing.prepared.sender.reference);
  assert.deepEqual(task.output?.[0]?.valueReference, { reference: "urn:uuid:document-reference" });
});

test("a held answer Dr. Hofer accepted carries the accepted-by-requester policy", () => {
  const { bundle } = buildFilingBundle(labFiling({ acceptedByRequester: true, findings: ["The eHVD does not list <her> at Labor Kanalstraße."] }));
  const { resource: provenance } = only<Provenance>(bundle, "Provenance");
  assert.deepEqual(provenance.policy, ["urn:aim-t2:identity-policy:lab-result:v1", ACCEPTED_BY_REQUESTER_POLICY]);
  assert.match(provenance.text?.div ?? "", /Dr\. Lena Hofer accepted the held answer\. The eHVD does not list &lt;her&gt; at Labor Kanalstraße\.<\/div>$/);
});

test("a person the bindings table knows is referenced, not created again", () => {
  const prepared = prepareParties({ ...rehabParties, sender: { ...rehabParties.sender, practitionerId: "kern-1" } }, { requestId: 2, uploadSha256: REHAB_SHA });
  assert.deepEqual(prepared.sender, { reference: "Practitioner/kern-1" });
  assert.equal(prepared.entries.filter((e) => e.resource?.resourceType === "Practitioner").length, 2);
});

test("an ID token without a login time is refused", () => {
  assert.throws(() => buildFilingBundle(labFiling({ idToken: idToken({}) })), /neither auth_time nor iat/);
});

test("buildTask mirrors a held request without output", () => {
  const task = buildTask({ ...request(3, "lab-result"), requestId: 3, state: "answer_held", businessStatus: "waiting for Dr. Hofer", requester: { reference: "Practitioner/1" }, owner: { display: "Dr. Eva Brandl" } });
  assert.equal(task.status, "on-hold");
  assert.deepEqual(task.businessStatus, { text: "waiting for Dr. Hofer" });
  assert.equal(task.output, undefined);
});

test("fileAnswer resolves the server ids and writes them to answer_filed", async () => {
  const filing = buildFilingBundle(labFiling());
  const locations: Record<string, string> = {
    Practitioner: "Practitioner/{n}/_history/1",
    Organization: "Organization/{n}/_history/1",
    DiagnosticReport: "DiagnosticReport/{n}/_history/1",
    Observation: "Observation/{n}/_history/1",
    Provenance: "Provenance/{n}/_history/1",
    Task: "http://localhost:8090/fhir/Task/ordy-request-1/_history/2",
  };
  const response: Bundle = {
    resourceType: "Bundle",
    type: "transaction-response",
    entry: filing.bundle.entry?.map((entry, n) => ({
      response: { status: "201 Created", location: locations[entry.resource?.resourceType ?? ""].replace("{n}", String(n + 10)) },
    })),
  };
  const audits: [number, AnswerFiled][] = [];
  const detail = await fileAnswer(1, filing, {
    transaction: async (bundle) => (assert.equal(bundle, filing.bundle), response),
    audit: async (requestId, entry) => void audits.push([requestId, entry]),
  });

  assert.deepEqual(detail, {
    output: "DiagnosticReport/14",
    targets: ["DiagnosticReport/14", "Observation/15", "Observation/16"],
    provenance: "Provenance/17",
    task: "Task/ordy-request-1",
    sender: "Practitioner/11",
    author: "Practitioner/11",
    organization: "Organization/12",
    resources: [
      "Practitioner/10",
      "Practitioner/11",
      "Organization/12",
      "Organization/13",
      "DiagnosticReport/14",
      "Observation/15",
      "Observation/16",
      "Provenance/17",
      "Task/ordy-request-1",
    ],
  });
  assert.deepEqual(audits, [[1, detail]]);
});

test("fileAnswer writes no audit entry when HAPI rejects the transaction", async () => {
  let audited = false;
  await assert.rejects(
    fileAnswer(1, buildFilingBundle(labFiling()), {
      transaction: async () => {
        throw new Error("FHIR request failed with 400");
      },
      audit: async () => void (audited = true),
    }),
    /400/,
  );
  assert.equal(audited, false);
});

const conditions = (bundle: Bundle) => (bundle.entry ?? []).map((e) => `${e.request?.method} ${e.request?.url} ${e.request?.ifNoneExist ?? ""}`);

test("every POST is conditional, and the same answer gives the same conditions again", () => {
  const first = buildFilingBundle(labFiling()).bundle;
  for (const entry of first.entry ?? []) if (entry.request?.method === "POST") assert.ok(entry.request.ifNoneExist, `${entry.request.url} is conditional`);
  assert.deepEqual(conditions(buildFilingBundle(labFiling()).bundle), conditions(first));
  // Another upload is another answer.
  assert.notDeepEqual(conditions(buildFilingBundle(labFiling({}, "c".repeat(64))).bundle), conditions(first));
});

test("buildFilingBundle refuses parties prepared for another request", () => {
  assert.throws(() => buildFilingBundle(labFiling({ request: request(9, "lab-result") })), /prepared for request 1, not 9/);
});

/**
 * A FHIR server with the transaction behaviour the filing relies on: conditional create on `identifier` and on
 * `target`, with `urn:uuid:` placeholders in the condition resolved to the ids of earlier entries (as HAPI does).
 */
function fakeServer() {
  const store = new Map<string, Resource & { identifier?: Identifier[]; target?: Reference[] }>();
  let next = 100;
  const matches = (resource: Resource & { identifier?: Identifier[]; target?: Reference[] }, condition: string) => {
    const [param, value] = [condition.slice(0, condition.indexOf("=")), condition.slice(condition.indexOf("=") + 1)];
    if (param === "target") return resource.target?.some((t) => t.reference === value) ?? false;
    const [system, code] = [value.slice(0, value.indexOf("|")), value.slice(value.indexOf("|") + 1)];
    return resource.identifier?.some((i) => i.system === system && i.value === code) ?? false;
  };
  async function transaction(bundle: Bundle): Promise<Bundle> {
    const ids = new Map<string, string>();
    const resolve = (text: string) => text.replace(/urn:uuid:[\w-]+/g, (u) => ids.get(u) ?? u);
    const writes: [string, Resource][] = [];
    const entry = (bundle.entry ?? []).map(({ fullUrl, resource, request }) => {
      if (!resource || !request) throw new Error("incomplete entry");
      if (request.method === "PUT") {
        writes.push([request.url, resource]);
        return { response: { status: "200 OK", location: `${request.url}/_history/1` } };
      }
      const condition = request.ifNoneExist && resolve(request.ifNoneExist);
      const found = condition ? [...store].find(([id, r]) => id.startsWith(`${request.url}/`) && matches(r, condition))?.[0] : undefined;
      const id = found ?? `${request.url}/${next++}`;
      if (fullUrl) ids.set(fullUrl, id);
      if (!found) writes.push([id, resource]);
      return { response: { status: found ? "200 OK" : "201 Created", location: `${id}/_history/1` } };
    });
    for (const [id, resource] of writes) store.set(id, JSON.parse(resolve(JSON.stringify(resource))));
    return { resourceType: "Bundle", type: "transaction-response", entry };
  }
  return { store, transaction };
}

test("a retry after a lost response files nothing new and writes answer_filed once", async () => {
  const server = fakeServer();
  const audits: AnswerFiled[] = [];
  const audit = async (_: number, detail: AnswerFiled) => void audits.push(detail);

  // HAPI commits, but the response never arrives (the 15 s timeout fires).
  await assert.rejects(
    fileAnswer(1, buildFilingBundle(labFiling()), {
      transaction: async (bundle) => {
        await server.transaction(bundle);
        throw new Error("The operation was aborted due to timeout");
      },
      audit,
    }),
    /timeout/,
  );
  const filed = new Map(server.store);
  assert.equal(filed.size, 9);
  assert.equal(audits.length, 0);

  // The caller rebuilds the Bundle from the same answer and tries again.
  const detail = await fileAnswer(1, buildFilingBundle(labFiling()), { transaction: server.transaction, audit });
  assert.deepEqual([...server.store.keys()], [...filed.keys()]);
  assert.deepEqual(audits, [detail]);
  assert.equal(detail.provenance, [...filed.keys()].find((id) => id.startsWith("Provenance/")));
  assert.deepEqual(server.store.get(detail.output), filed.get(detail.output));

  // The audit insert fails after HAPI answered: the retry again files nothing new.
  await assert.rejects(fileAnswer(1, buildFilingBundle(labFiling()), { transaction: server.transaction, audit: async () => Promise.reject(new Error("db down")) }));
  assert.equal(server.store.size, 9);

  // A different upload is a new answer and is filed again.
  await fileAnswer(1, buildFilingBundle(labFiling({}, "c".repeat(64))), { transaction: server.transaction, audit });
  assert.equal(server.store.size, 9 + 4);
});
