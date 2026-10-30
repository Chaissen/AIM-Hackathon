import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createEhvdClient, type EhvdClient } from "./client";
import { startEhvdMock } from "./start-mock";

// The client against the T23 mock, which checks every request against the WSDL and answers with an empty 403 otherwise.

let mock: Awaited<ReturnType<typeof startEhvdMock>>;
let client: EhvdClient;

before(async () => {
  mock = await startEhvdMock();
  client = createEhvdClient({ url: mock.url });
});
after(() => mock.close());

test("GetGDA reads Dr. Eva Brandl's entry", async () => {
  const result = await client.getGda({ id: "1.2.40.0.34.3.2.99.1.2" });
  assert.ok(result.ok && result.value);
  const eva = result.value;
  assert.deepEqual([eva.title, eva.firstname, eva.surname], ["Dr.", "Eva", "Brandl"]);
  assert.deepEqual(eva.status, { ehvdstatus: "Aktiv", elgastatus: "Aktiv" });
  assert.deepEqual(eva.roles, { role: ["1.2.40.0.34.5.2:159"], elgaRole: ["1.2.40.0.34.5.3:700"], specialisation: ["1.2.40.0.34.3.1.10.20:19"] });
  assert.deepEqual(eva.relations.memberof, ["1.2.40.0.34.3.1.99.1.2"]);
  assert.deepEqual(eva.otherID, ["1.2.40.0.34.4.18:99002"]);
});

test("GetGDA without a hit is null, not a failure", async () => {
  assert.deepEqual(await client.getGda({ id: "1.2.40.0.34.3.2.99.9.1" }), { ok: true, value: null });
  // An Arzt-Nr with its kind of id.
  const byNumber = await client.getGda({ oidIssuingAuthority: "1.2.40.0.34.4.18", id: "99002" });
  assert.equal(byNumber.ok && byNumber.value?.surname, "Brandl");
});

test("GdaSearch finds Labor Kanalstraße with its mail address", async () => {
  const result = await client.gdaSearch({ surname: "Labor Kanalstraße", maxResults: 10, ehvdstatus: "Aktiv" });
  assert.ok(result.ok);
  assert.deepEqual(
    result.value.map((gda) => [gda.id.id, gda.mail]),
    [["1.2.40.0.34.3.1.99.1.2", "office@labor-kanal.example"]],
  );
});

test("a search with every field passes the mock's WSDL check", async () => {
  const result = await client.gdaSearch({
    firstname: "Eva",
    surname: "Brandl",
    rolecode: "159",
    postcode: "1000",
    streetNumber: "12",
    streetName: "Kanalstraße",
    city: "Beispielstadt",
    state: "Wien",
    maxResults: 5,
    ehvdstatus: "Aktiv",
    elgastatus: "Aktiv",
    description: "Registrierungsstelle",
  });
  // Fields out of WSDL order would be an empty HTTP 403 here.
  assert.deepEqual(result, { ok: true, value: [] });
});

test("faults come back with their eHVD number", async () => {
  const faultCode = (result: Awaited<ReturnType<EhvdClient["getGda"]>> | Awaited<ReturnType<EhvdClient["gdaSearch"]>>) =>
    !result.ok && result.failure.kind === "fault" ? result.failure.code : "no fault";
  assert.equal(faultCode(await client.getGda({ id: "1.2.40.0.34.3.1.99.9.6003" })), 6003);
  assert.equal(faultCode(await client.getGda({ id: "1.2.40.0.34.3.1.99.9.6004" })), 6004);
  assert.equal(faultCode(await client.gdaSearch({ surname: "Brandl", maxResults: 1 })), 6005);
});

test("fault 6006 when the caller may use only the other operation", async () => {
  const limited = await startEhvdMock({ EHVD_ALLOWLIST: "127.0.0.0/8 GetGDA" });
  try {
    const result = await createEhvdClient({ url: limited.url }).gdaSearch({ surname: "Brandl", maxResults: 10 });
    assert.deepEqual(result, { ok: false, failure: { kind: "fault", code: 6006, message: "User/Role is not allowed to use this webservice interface!" } });
  } finally {
    await limited.close();
  }
});

test("the firewall's empty 403, a closed port, and a timeout are unreachable", async () => {
  const firewall = await startEhvdMock({ EHVD_ALLOWLIST: "10.0.0.0/8" });
  const silent = createServer(() => {}); // accepts the connection and never answers
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  try {
    const blocked = await createEhvdClient({ url: firewall.url }).getGda({ id: "1.2.40.0.34.3.2.99.1.2" });
    assert.deepEqual(blocked, { ok: false, failure: { kind: "unreachable", detail: "HTTP 403" } });

    const closed = await createEhvdClient({ url: "http://127.0.0.1:9/" }).getGda({ id: "1.2.40.0.34.3.2.99.1.2" });
    assert.equal(!closed.ok && closed.failure.kind, "unreachable");

    const { port } = silent.address() as { port: number };
    const slow = await createEhvdClient({ url: `http://127.0.0.1:${port}/`, timeoutMs: 100 }).getGda({ id: "1.2.40.0.34.3.2.99.1.2" });
    assert.deepEqual(slow, { ok: false, failure: { kind: "unreachable", detail: "no answer within 100 ms" } });
  } finally {
    await firewall.close();
    silent.closeAllConnections();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  }
});

test("values that break the field rules are never sent", async () => {
  const cases: [Parameters<EhvdClient["gdaSearch"]>[0], string][] = [
    [{ surname: "Br*", maxResults: 10 }, "surname"], // ordy never searches with a wildcard
    [{ surname: "Brandl & Co", maxResults: 10 }, "surname"],
    [{ surname: " Brandl", maxResults: 10 }, "surname"],
    [{ surname: "Brandl", maxResults: 201 }, "maxResults"],
    [{ surname: "Brandl", firstname: "x".repeat(129), maxResults: 10 }, "firstname"],
  ];
  for (const [query, field] of cases) {
    const result = await client.gdaSearch(query);
    assert.equal(!result.ok && result.failure.kind === "bad_request" && result.failure.field, field, JSON.stringify(query));
  }
  const id = await client.getGda({ id: "1.2.40.0.34.3.2.99.1.2 " });
  assert.equal(!id.ok && id.failure.kind, "bad_request");
});
