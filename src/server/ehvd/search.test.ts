import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createEhvdClient, type EhvdClient } from "./client";
import { searchDirectory } from "./search";
import { startEhvdMock } from "./start-mock";

let mock: Awaited<ReturnType<typeof startEhvdMock>>;
let client: EhvdClient;

before(async () => {
  mock = await startEhvdMock();
  client = createEhvdClient({ url: mock.url });
});
after(() => mock.close());

const LABOR = "1.2.40.0.34.3.1.99.1.2";

async function names(query: string) {
  const result = await searchDirectory(query, client);
  assert.equal(result.status, "ok");
  return result.entries.map((entry) => [entry.name, entry.active]);
}

test("Brandl finds Dr. Eva Brandl at Labor Kanalstraße, Dr. Martin Brandl, and the inactive Dr. Eva Brandl-Huber", async () => {
  const result = await searchDirectory("Brandl", client);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.entries[0], {
    oid: "1.2.40.0.34.3.2.99.1.2",
    kind: "person",
    name: "Dr. Eva Brandl",
    given: "Eva",
    family: "Brandl",
    active: true,
    roles: ["specialist physician"],
    specialisations: ["medical and chemical laboratory diagnostics"],
    memberOf: [{ oid: LABOR, name: "Labor Kanalstraße" }],
    mailDomain: null,
    city: "Beispielstadt",
    suggestedDocType: "lab-result",
  });
  assert.deepEqual(await names("Brandl"), [
    ["Dr. Eva Brandl", true],
    ["Dr. Martin Brandl", true],
    ["Dr. Eva Brandl-Huber", false],
  ]);
});

test("every word of the query must be in the name", async () => {
  assert.deepEqual(await names("Eva Brandl"), [
    ["Dr. Eva Brandl", true],
    ["Dr. Eva Brandl-Huber", false],
  ]);
  assert.deepEqual(await names("Dr. Martin Brandl"), [["Dr. Martin Brandl", true]]);
  // *Magdalena* finds no surname, so the search goes on with *Haas*.
  assert.deepEqual(await names("Magdalena Haas"), [["Prim. Dr. Magdalena Haas", true]]);
});

test("Kanalstraße finds the lab with its mail domain", async () => {
  assert.deepEqual(await searchDirectory("Kanalstraße", client), {
    status: "ok",
    entries: [
      {
        oid: LABOR,
        kind: "organisation",
        name: "Labor Kanalstraße",
        given: null,
        family: "Labor Kanalstraße",
        active: true,
        roles: ["independent outpatient clinic"],
        specialisations: [],
        memberOf: [],
        mailDomain: "labor-kanal.example",
        city: "Beispielstadt",
        suggestedDocType: null,
      },
    ],
  });
});

test("a member of a rehab clinic gets the rehab report suggested", async () => {
  const result = await searchDirectory("Leitner", client);
  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.entries.map(({ name, memberOf, suggestedDocType }) => ({ name, memberOf, suggestedDocType })),
    [{ name: "Dr. Johanna Leitner", memberOf: [{ oid: "1.2.40.0.34.3.1.99.1.3", name: "Reha Waldblick" }], suggestedDocType: "rehab-report" }],
  );
});

test("a name the eHVD cannot search is invalid", async () => {
  const invalid = {
    status: "invalid",
    message: "The eHVD needs a name with at least two letters from A to Z, and allows only letters, digits, blanks, and . - ~ _ + = /.",
  };
  assert.deepEqual(await searchDirectory("Öz", client), invalid);
  assert.deepEqual(await searchDirectory("O'Brandl", client), invalid);
  assert.deepEqual(await searchDirectory("--", client), invalid);
});

test("more than 50 hits is too many", async () => {
  assert.deepEqual(await searchDirectory("er", client), { status: "too_many" });
});

test("an eHVD that cannot be reached or answers with an error is unavailable", async () => {
  assert.deepEqual(await searchDirectory("Brandl", createEhvdClient({ url: "http://127.0.0.1:9/" })), { status: "unavailable" });
  const getGdaOnly = await startEhvdMock({ EHVD_ALLOWLIST: "127.0.0.0/8 GetGDA" });
  try {
    assert.deepEqual(await searchDirectory("Brandl", createEhvdClient({ url: getGdaOnly.url })), { status: "unavailable" });
  } finally {
    await getGdaOnly.close();
  }
});
