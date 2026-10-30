import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addressWarning, checkAddress } from "./address-check";
import { createEhvdClient, type EhvdClient } from "./client";
import { startEhvdMock } from "./start-mock";

let mock: Awaited<ReturnType<typeof startEhvdMock>>;
let client: EhvdClient;
const down = createEhvdClient({ url: "http://127.0.0.1:9/" });

before(async () => {
  mock = await startEhvdMock();
  client = createEhvdClient({ url: mock.url });
});
after(() => mock.close());

const email = (address: string, org = "Labor Kanalstraße") => ({ channel: "email" as const, address, org });

test("Dr. Brandl's address at Labor Kanalstraße passes, in any case", async () => {
  assert.deepEqual(await checkAddress(email("eva.brandl@labor-kanal.example"), client), { result: "pass" });
  assert.deepEqual(await checkAddress(email("Eva.Brandl@LABOR-KANAL.example"), client), { result: "pass" });
});

test("M1: labor-kanaI.example with a capital I is a mismatch, with the warning from the docs", async () => {
  const check = await checkAddress(email("eva.brandl@labor-kanaI.example"), client);
  assert.deepEqual(check, { result: "mismatch", domain: "labor-kanaI.example", expectedDomain: "labor-kanal.example" });
  assert.equal(addressWarning(check, "Labor Kanalstraße"), "The address domain labor-kanaI.example does not match Labor Kanalstraße (labor-kanal.example).");
});

test("only one plain address with an ASCII domain can pass", async () => {
  // Each of these would end in labor-kanal.example if the check only lowercased the part after the last @.
  for (const address of ["eva@labor-\u212Aanal.example", "eva@evil.example, x@labor-kanal.example", "eva@evil.example@labor-kanal.example", "eva@labor-kanal.example\n"]) {
    assert.deepEqual(await checkAddress(email(address), client), { result: "unchecked", reason: "invalid_address" }, JSON.stringify(address));
  }
});

test("an SMS has no address check and needs no eHVD", async () => {
  assert.deepEqual(await checkAddress({ channel: "sms", address: "+43 660 000 0101", org: "Reha Waldblick" }, down), { result: "pass" });
});

test("an address the eHVD cannot confirm is never a pass", async () => {
  assert.deepEqual(await checkAddress(email("someone@nowhere.example", "Labor Nirgendwo"), client), { result: "unchecked", reason: "organisation_not_listed" });
  // The search compares the whole name.
  assert.deepEqual(await checkAddress(email("eva.brandl@labor-kanal.example", "Labor Kanal"), client), { result: "unchecked", reason: "organisation_not_listed" });
  assert.deepEqual(await checkAddress(email("x@y.example", "Labor & Partner"), client), { result: "unchecked", reason: "not_searchable" });
  const unreachable = await checkAddress(email("eva.brandl@labor-kanal.example"), down);
  assert.deepEqual(unreachable, { result: "unchecked", reason: "ehvd_unreachable" });
  assert.equal(addressWarning(unreachable, "Labor Kanalstraße"), "The eHVD could not be reached, so the address could not be checked.");
});

test("an eHVD that answers with an error is not called unreachable", async () => {
  const getGdaOnly = await startEhvdMock({ EHVD_ALLOWLIST: "127.0.0.0/8 GetGDA" });
  try {
    const check = await checkAddress(email("eva.brandl@labor-kanal.example"), createEhvdClient({ url: getGdaOnly.url }));
    assert.deepEqual(check, { result: "unchecked", reason: "ehvd_error" });
    assert.equal(addressWarning(check, "Labor Kanalstraße"), "The eHVD answered with an error, so the address could not be checked.");
  } finally {
    await getGdaOnly.close();
  }
});
