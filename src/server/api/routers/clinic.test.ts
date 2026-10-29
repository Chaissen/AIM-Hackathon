import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { env } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContextFromRequest, type Actor, type Context } from "@/server/api/trpc";
import { signEidSession, type EidSession } from "@/server/auth/eid-session";

const outside: EidSession = {
  requestId: 1, personNumber: "synthetic-bpk", givenName: "Eva", familyName: "Brandl",
  level: "urn:eidgvat:eid.status.full", gdaOid: null, idToken: "synthetic-token",
};
const forbiddenDb = { select: () => assert.fail("Unauthorized request reached the database") } as unknown as Context["db"];
const unauthorized = { code: "UNAUTHORIZED" };

test("patient and audit queries reject anonymous and outside-person actors before reading data", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("Unauthorized request reached FHIR"));
  for (const actor of [{ kind: "anonymous" }, { kind: "eid", session: outside }] satisfies Actor[]) {
    const caller = createCaller({ actor, db: forbiddenDb });
    await assert.rejects(caller.clinic.patients(), unauthorized);
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
