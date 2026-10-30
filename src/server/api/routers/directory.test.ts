import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { Actor, Context } from "@/server/api/trpc";
import type { EidSession } from "@/server/auth/eid-session";
import { startEhvdMock } from "@/server/ehvd/start-mock";

// The directory procedures against an eHVD mock started in this process. The client reads EHVD_URL once, when it is
// imported, so the router is imported after the mock listens.

let mock: Awaited<ReturnType<typeof startEhvdMock>>;
let createCaller: typeof import("@/server/api/root").createCaller;
let env: typeof import("@/env").env;

before(async () => {
  mock = await startEhvdMock();
  process.env.EHVD_URL = mock.url;
  ({ createCaller } = await import("@/server/api/root"));
  ({ env } = await import("@/env"));
});
after(() => mock.close());

const outside: EidSession = {
  requestId: 1, personNumber: "synthetic-bpk", givenName: "Eva", familyName: "Brandl",
  level: "urn:eidgvat:eid.status.full", gdaOid: null,
};
// Neither procedure reads the database.
const noDb = { select: () => assert.fail("The directory reached the database") } as unknown as Context["db"];
const hofer = () => createCaller({ actor: { kind: "clinic", mxid: "@lena.hofer:klinikum.example" }, db: noDb, matrix: null });

test("the directory rejects anonymous and outside-person actors before asking the eHVD", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("Unauthorized request reached the eHVD"));
  for (const actor of [{ kind: "anonymous" }, { kind: "eid", session: outside }] satisfies Actor[]) {
    const caller = createCaller({ actor, db: noDb, matrix: null });
    await assert.rejects(caller.directory.listed(), { code: "UNAUTHORIZED" });
    await assert.rejects(caller.directory.search({ name: "Brandl" }), { code: "UNAUTHORIZED" });
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("listed returns the entries of EHVD_DIRECTORY_OIDS", async () => {
  const listing = await hofer().directory.listed();
  assert.equal(listing.status, "ok");
  assert.deepEqual(listing.entries.map((entry) => entry.oid), env.EHVD_DIRECTORY_OIDS);

  const configured = env.EHVD_DIRECTORY_OIDS;
  env.EHVD_DIRECTORY_OIDS = ["1.2.40.0.34.3.1.99.1.2"];
  try {
    const lab = await hofer().directory.listed();
    assert.equal(lab.status, "ok");
    assert.deepEqual(lab.entries.map((entry) => entry.name), ["Labor Kanalstraße"]);
  } finally {
    env.EHVD_DIRECTORY_OIDS = configured;
  }
});

test("search and listed return the same entry", async () => {
  const [listing, search] = await Promise.all([hofer().directory.listed(), hofer().directory.search({ name: "Eva Brandl" })]);
  assert.equal(listing.status, "ok");
  assert.equal(search.status, "ok");
  const eva = (entries: typeof listing.entries) => entries.find((entry) => entry.oid === "1.2.40.0.34.3.2.99.1.2");
  assert.deepEqual(eva(listing.entries), eva(search.entries));
});
