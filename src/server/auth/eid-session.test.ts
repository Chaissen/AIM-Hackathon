import assert from "node:assert/strict";
import { test } from "node:test";

import { type EidSession, gdaOidFromClaim, readEidSession, signEidSession } from "./eid-session";

const base64 = (text: string | Buffer) => Buffer.from(text).toString("base64");
const gdaWithId = (id: string) => base64(JSON.stringify({ gda: { id: { oidIssuingAuthority: "1.2.40.0.34", id } } }));

test("gdaOidFromClaim reads Eva Brandl's eHVD OID", () => {
  const eva = base64(
    '{"gda":{"id":{"oidIssuingAuthority":"1.2.40.0.34","id":"1.2.40.0.34.3.2.99.1.2"},"status":{"ehvdstatus":"Aktiv","elgastatus":"Aktiv"},"firstname":"Eva","surname":"Brandl","title":"Dr.","description":["Registrierungsstelle:Österreichische Ärztekammer"],"roles":{"role":["1.2.40.0.34.5.2:159"],"elgaRole":["1.2.40.0.34.5.3:700"],"specialisation":["1.2.40.0.34.3.1.10.20:19"]},"timestamps":{"add":"2019-03-01","modify":"2026-01-15"}}}',
  );
  assert.equal(gdaOidFromClaim(eva), "1.2.40.0.34.3.2.99.1.2");
});

test("gdaOidFromClaim gives null without the claim", () => {
  assert.equal(gdaOidFromClaim(undefined), null);
});

test("gdaOidFromClaim gives an Error for a present but unreadable claim", () => {
  const unreadable: [string, unknown][] = [
    ["null", null],
    ["a number", 42],
    ["not base64", "not base64!"],
    ["base64 of not JSON", base64("not json")],
    ["base64 of invalid UTF-8", base64(Buffer.from([0xff, 0xfe, 0xfd]))],
    ["no gda.id", base64('{"gda":{}}')],
    ["blank OID", gdaWithId("  ")],
    ["not an OID", gdaWithId("not an oid")],
  ];
  for (const [label, value] of unreadable) {
    assert.ok(gdaOidFromClaim(value) instanceof Error, label);
  }
});

const session: EidSession = {
  requestId: 1,
  personNumber: "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=",
  givenName: "Eva",
  familyName: "Brandl",
  level: "urn:eidgvat:eid.status.full",
  gdaOid: "1.2.40.0.34.3.2.99.1.2",
  idToken: "eyJhbGciOiJSUzI1NiJ9.eyJnaXZlbl9uYW1lIjoiRXZhIn0.c2lnbmF0dXJl",
};

test("a signed session reads back unchanged", async () => {
  const read = await readEidSession(await signEidSession(session));
  assert.deepEqual(read, {
    requestId: 1,
    personNumber: "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=",
    givenName: "Eva",
    familyName: "Brandl",
    level: "urn:eidgvat:eid.status.full",
    gdaOid: "1.2.40.0.34.3.2.99.1.2",
    idToken: "eyJhbGciOiJSUzI1NiJ9.eyJnaXZlbl9uYW1lIjoiRXZhIn0.c2lnbmF0dXJl",
  });
});

test("a tampered or missing cookie reads as null", async () => {
  const cookie = await signEidSession(session);
  // The first signature character carries six full bits, so changing it always changes the signature.
  const at = cookie.lastIndexOf(".") + 1;
  const tampered = cookie.slice(0, at) + (cookie[at] === "A" ? "B" : "A") + cookie.slice(at + 1);
  assert.equal((await readEidSession(cookie))?.requestId, 1);
  assert.equal(await readEidSession(tampered), null);
  assert.equal(await readEidSession(undefined), null);
});
