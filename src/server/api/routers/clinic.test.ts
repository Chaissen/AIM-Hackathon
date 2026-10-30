import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";

import { eq, inArray, sql } from "drizzle-orm";

import { env, mxid } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext, createContextFromRequest, type Actor, type Context } from "@/server/api/trpc";
import { signEidSession, type EidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { auditLog, bindings, requests } from "@/server/db/schema";
import { capabilities, fhirFetch } from "@/server/fhir/client";
import { createRequest, type NewRequest } from "@/server/requests/service";

const outside: EidSession = {
  requestId: 1, personNumber: "synthetic-bpk", givenName: "Eva", familyName: "Brandl",
  level: "urn:eidgvat:eid.status.full", gdaOid: null,
};
const forbiddenDb = { select: () => assert.fail("Unauthorized request reached the database") } as unknown as Context["db"];
const unauthorized = { code: "UNAUTHORIZED" };

// The patient and contacts tests run against the Postgres from DATABASE_URL and the FHIR server from FHIR_BASE_URL.
const noDb = await db.execute(sql`select 1`).then(
  () => false,
  () => "Postgres is not reachable, start it with ./scripts/setup.sh",
);
const noFhir = await capabilities(AbortSignal.timeout(3_000)).then(() => false, () => "the FHIR server is not reachable");
const run = randomBytes(4).toString("hex");
const created: number[] = [];
const labOrg = `Labor Kanalstraße test ${run}`;

after(async () => {
  await Promise.all(created.map((id) => fhirFetch(`Task/ordy-request-${id}`, { method: "DELETE" }).catch(() => {})));
  if (!noDb && created.length) {
    await db.delete(auditLog).where(inArray(auditLog.requestId, created));
    await db.delete(requests).where(inArray(requests.id, created));
    await db.delete(bindings).where(eq(bindings.org, labOrg));
  }
  await db.$client.end();
});

test("patient and audit queries reject anonymous and outside-person actors before reading data", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("Unauthorized request reached FHIR"));
  for (const actor of [{ kind: "anonymous" }, { kind: "eid", session: outside }] satisfies Actor[]) {
    const caller = createCaller({ actor, db: forbiddenDb, matrix: null });
    await assert.rejects(caller.clinic.patients(), unauthorized);
    await assert.rejects(caller.clinic.patient({ id: "maria-beispiel" }), unauthorized);
    await assert.rejects(caller.clinic.contacts(), unauthorized);
    await assert.rejects(caller.clinic.audit(), unauthorized);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("forwarded headers and a valid outside-person cookie cannot grant clinic access", async () => {
  env.ORDY_SECRET = randomBytes(32).toString("hex");
  for (const cookie of ["", `ordy_eid_session=${await signEidSession(outside)}`]) {
    const context = await createContextFromRequest(new Request("http://localhost/api/trpc/clinic.audit", {
      headers: { host: "localhost:3010", "x-forwarded-for": "127.0.0.1", cookie },
    }));
    assert.notEqual(context.actor.kind, "clinic");
    const caller = createCaller({ ...context, db: forbiddenDb });
    await assert.rejects(caller.clinic.patients(), unauthorized);
    await assert.rejects(caller.clinic.audit(), unauthorized);
  }
});

test("invalid and foreign-homeserver Matrix tokens cannot read clinic data", async (t) => {
  for (const reply of [new Response("{}", { status: 401 }), Response.json({ sub: "@someone:other.example" })]) {
    const fetch = t.mock.method(globalThis, "fetch", async () => reply.clone());
    const context = await createContextFromRequest(new Request("http://localhost/api/trpc/clinic.audit", {
      headers: { authorization: "Bearer untrusted" },
    }));
    const caller = createCaller({ ...context, db: forbiddenDb });
    await assert.rejects(caller.clinic.patients(), unauthorized);
    await assert.rejects(caller.clinic.audit(), unauthorized);
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test("clinic.me rejects anonymous and outside-person actors before asking Synapse", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("Unauthorized request reached Synapse"));
  for (const actor of [{ kind: "anonymous" }, { kind: "eid", session: outside }] satisfies Actor[]) {
    await assert.rejects(createCaller({ actor, db: forbiddenDb, matrix: null }).clinic.me(), unauthorized);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("clinic.me returns the Synapse display name, or the Matrix ID when Synapse has none", async (t) => {
  const hofer = `@lena.hofer:${env.MATRIX_SERVER_NAME}`;
  const caller = createCaller({ actor: { kind: "clinic", mxid: hofer }, db: forbiddenDb, matrix: null });
  const profile = `${env.MATRIX_HOMESERVER_URL}/_matrix/client/v3/profile/${encodeURIComponent(hofer)}/displayname`;
  for (const [reply, displayName] of [
    [Response.json({ displayname: "Dr. Lena Hofer" }), "Dr. Lena Hofer"],
    [Response.json({}), hofer],
    [Response.json({ errcode: "M_NOT_FOUND", error: "Profile not found" }, { status: 404 }), hofer],
  ] as const) {
    const fetch = t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
      assert.equal(String(url), profile);
      return reply.clone();
    });
    assert.deepEqual(await caller.clinic.me(), { mxid: hofer, displayName, clinic: env.CLINIC_NAME });
    assert.equal(fetch.mock.callCount(), 1);
    fetch.mock.restore();
  }
});

test("a server-verified Matrix clinic identity can read patients and the audit log", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).includes("/_matrix/federation/v1/openid/userinfo")) return Response.json({ sub: `@lena.hofer:${env.MATRIX_SERVER_NAME}` });
    assert.equal(String(url), `${env.FHIR_BASE_URL}/Patient?_count=50&_sort=family`);
    return Response.json({ resourceType: "Bundle", entry: [{ resource: { resourceType: "Patient", id: "synthetic", name: [{ given: ["Maria"], family: "Beispiel" }], birthDate: "1961-03-12" } }] });
  });
  const context = await createContextFromRequest(new Request("http://localhost/api/trpc/clinic.patients", { headers: { authorization: "Bearer valid" } }));
  assert.deepEqual(context.actor, { kind: "clinic", mxid: `@lena.hofer:${env.MATRIX_SERVER_NAME}` });
  const rows = [{ id: 7, event: "identity_checked" }];
  const db = { select: () => ({ from: () => ({ orderBy: () => ({ limit: async (limit: number) => { assert.equal(limit, 500); return rows; } }) }) }) } as unknown as Context["db"];
  const caller = createCaller({ ...context, db });
  assert.deepEqual(await caller.clinic.patients(), [{ id: "synthetic", name: "Maria Beispiel", birthDate: "1961-03-12" }]);
  assert.deepEqual(await caller.clinic.audit(), rows);
  assert.equal(fetch.mock.callCount(), 2);
});

test("clinic.patient reads one patient from the FHIR server, and an unknown id is not found", { skip: noFhir }, async () => {
  const clinic = createCaller(createContext({ kind: "clinic", mxid: mxid(env.MATRIX_HOFER_USER) }));
  assert.deepEqual(await clinic.clinic.patient({ id: "maria-beispiel" }), {
    id: "maria-beispiel",
    name: "Maria Beispiel",
    birthDate: "1961-03-12",
    gender: "female",
    address: "Musterstraße 1, 1000 Beispielstadt",
  });
  await assert.rejects(clinic.clinic.patient({ id: `nobody-${run}` }), { code: "NOT_FOUND" });
});

test("clinic.contacts groups the caller's requests by person and organisation, newest first", { skip: noDb }, async () => {
  const requester = mxid(`contacts-test-${run}`);
  const ask = async (overrides: Partial<NewRequest>) => {
    const { request } = await createRequest(
      db,
      {
        docType: "lab-result",
        patientId: "maria-beispiel",
        given: "Eva",
        family: "Brandl",
        org: labOrg,
        channel: "email",
        address: "eva.brandl@labor-kanal.example",
        requester,
        requesterName: "Dr. Contacts Test",
        ...overrides,
      },
      { passed: true },
      async () => {},
    );
    created.push(request.id);
    return request;
  };
  await db.insert(bindings).values({ given: "Eva", family: "Brandl", org: labOrg, personNumber: `GH:contacts-${run}` });

  await ask({});
  const kern = await ask({ docType: "rehab-report", given: "Stefan", family: "Kern", org: `Reha Waldblick test ${run}`, channel: "sms", address: "+43 660 000 0101" });
  await ask({});
  await ask({ requester: mxid(`contacts-other-${run}`), requesterName: "Dr. Someone Else" });
  const newest = await ask({ address: "e.brandl@labor-kanal.example" });

  const contacts = await createCaller(createContext({ kind: "clinic", mxid: requester })).clinic.contacts();
  assert.deepEqual(contacts, [
    {
      given: "Eva",
      family: "Brandl",
      org: labOrg,
      channel: "email",
      address: "e.brandl@labor-kanal.example",
      docType: "lab-result",
      requests: 3,
      lastRequestId: newest.id,
      lastRequestedAt: newest.createdAt,
      verified: true,
    },
    {
      given: "Stefan",
      family: "Kern",
      org: `Reha Waldblick test ${run}`,
      channel: "sms",
      address: "+43 660 000 0101",
      docType: "rehab-report",
      requests: 1,
      lastRequestId: kern.id,
      lastRequestedAt: kern.createdAt,
      verified: false,
    },
  ]);
});
