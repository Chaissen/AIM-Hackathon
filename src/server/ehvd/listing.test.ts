import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { env } from "@/env";

import { createEhvdClient, type EhvdClient } from "./client";
import { listDirectory } from "./listing";
import { startEhvdMock } from "./start-mock";

let mock: Awaited<ReturnType<typeof startEhvdMock>>;
let client: EhvdClient;

before(async () => {
  mock = await startEhvdMock();
  client = createEhvdClient({ url: mock.url });
});
after(() => mock.close());

const KLINIKUM = "1.2.40.0.34.3.1.99.1.1";
const LABOR = "1.2.40.0.34.3.1.99.1.2";
const REHA = "1.2.40.0.34.3.1.99.1.3";
const HOFER = "1.2.40.0.34.3.2.99.1.1";
const EVA = "1.2.40.0.34.3.2.99.1.2";
const LEITNER = "1.2.40.0.34.3.2.99.1.3";
const MARTIN = "1.2.40.0.34.3.2.99.1.4";
const BRANDL_HUBER = "1.2.40.0.34.3.2.99.1.5";

/** A client whose GetGDA answers count, so a test can tell how many calls the listing made. */
function counting(): { client: EhvdClient; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    client: {
      getGda: (query) => {
        calls.push(query.id);
        return client.getGda(query);
      },
      gdaSearch: () => assert.fail("The listing never searches"),
    },
  };
}

test("the default OIDs are the scenario entries, in the configured order", async () => {
  assert.deepEqual(env.EHVD_DIRECTORY_OIDS, [KLINIKUM, LABOR, REHA, HOFER, EVA, LEITNER, MARTIN, BRANDL_HUBER]);
  const result = await listDirectory(env.EHVD_DIRECTORY_OIDS, client);
  assert.equal(result.status, "ok");
  assert.equal(result.failed, 0);
  assert.deepEqual(
    result.entries.map(({ name, kind, active, inNetwork }) => [name, kind, active, inNetwork]),
    [
      ["Klinikum Beispielstadt", "organisation", true, true],
      ["Labor Kanalstraße", "organisation", true, false],
      ["Reha Waldblick", "organisation", true, false],
      ["Dr. Lena Hofer", "person", true, true],
      ["Dr. Eva Brandl", "person", true, false],
      ["Dr. Johanna Leitner", "person", true, false],
      ["Dr. Martin Brandl", "person", true, false],
      ["Dr. Eva Brandl-Huber", "person", false, false],
    ],
  );
});

test("an entry has the same shape as a search hit, with its organisation's name and the suggested document type", async () => {
  const result = await listDirectory([LABOR, EVA, LEITNER], client);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.entries[1], {
    oid: EVA,
    kind: "person",
    name: "Dr. Eva Brandl",
    title: "Dr.",
    given: "Eva",
    family: "Brandl",
    active: true,
    roles: ["specialist physician"],
    specialisations: ["medical and chemical laboratory diagnostics"],
    memberOf: [{ oid: LABOR, name: "Labor Kanalstraße" }],
    mailDomain: null,
    city: "Beispielstadt",
    suggestedDocType: "lab-result",
    inNetwork: false,
  });
  // Reha Waldblick is not listed, so its name comes from one more GetGDA.
  assert.deepEqual(
    result.entries.map(({ name, memberOf, suggestedDocType }) => ({ name, memberOf, suggestedDocType })),
    [
      { name: "Labor Kanalstraße", memberOf: [], suggestedDocType: null },
      { name: "Dr. Eva Brandl", memberOf: [{ oid: LABOR, name: "Labor Kanalstraße" }], suggestedDocType: "lab-result" },
      { name: "Dr. Johanna Leitner", memberOf: [{ oid: REHA, name: "Reha Waldblick" }], suggestedDocType: "rehab-report" },
    ],
  );
});

test("each OID is looked up once, and organisations among them need no second call", async () => {
  const { client: counted, calls } = counting();
  const result = await listDirectory([LABOR, EVA, EVA, LABOR], counted);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.entries.map((entry) => entry.oid), [LABOR, EVA]);
  assert.deepEqual(calls, [LABOR, EVA]);
});

test("a member of the clinic that runs ordy is in the network, so the widget offers no request to them", async () => {
  const result = await listDirectory([HOFER, EVA], client);
  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.entries.map(({ name, inNetwork }) => [name, inNetwork]),
    [
      ["Dr. Lena Hofer", true],
      ["Dr. Eva Brandl", false],
    ],
  );
});

test("an OID the eHVD does not list is left out, and a failed lookup is counted", async () => {
  // 6002 for an unknown OID, 6003 for the reserved one, 6004 for the entry without timestamps.
  const result = await listDirectory(["1.2.40.0.34.3.2.99.1.9999", "1.2.40.0.34.3.1.99.9.6003", "1.2.40.0.34.3.1.99.9.6004", EVA], client);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.entries.map((entry) => entry.name), ["Dr. Eva Brandl"]);
  assert.equal(result.failed, 2);
});

test("an answer with another entry's id counts as failed", async () => {
  const swapped: EhvdClient = { ...client, getGda: (query) => client.getGda({ id: query.id === EVA ? MARTIN : query.id }) };
  const result = await listDirectory([EVA, LABOR], swapped);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.entries.map((entry) => entry.name), ["Labor Kanalstraße"]);
  assert.equal(result.failed, 1);
});

test("no OIDs list nothing without a call", async () => {
  const { client: counted, calls } = counting();
  assert.deepEqual(await listDirectory([], counted), { status: "ok", entries: [], failed: 0 });
  assert.equal(calls.length, 0);
});

test("an eHVD that cannot be reached or refuses GetGDA is unavailable", async () => {
  assert.deepEqual(await listDirectory([LABOR, EVA], createEhvdClient({ url: "http://127.0.0.1:9/" })), { status: "unavailable" });
  const searchOnly = await startEhvdMock({ EHVD_ALLOWLIST: "127.0.0.0/8 GdaSearch" });
  try {
    assert.deepEqual(await listDirectory([LABOR, EVA], createEhvdClient({ url: searchOnly.url })), { status: "unavailable" });
  } finally {
    await searchOnly.close();
  }
});
