import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, test } from "node:test";
import { SignJWT } from "jose";

import { env } from "@/env";

import {
  type EidSession,
  gdaOidFromClaim,
  type LoginTransaction,
  readEidSession,
  readLoginTransaction,
  signEidSession,
  signLoginTransaction,
} from "./eid-session";

beforeEach(() => { env.ORDY_SECRET = randomBytes(32).toString("hex"); });

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
  });
});

// The first signature character carries six full bits, so changing it always changes the signature.
const tamper = (cookie: string) => {
  const at = cookie.lastIndexOf(".") + 1;
  return cookie.slice(0, at) + (cookie[at] === "A" ? "B" : "A") + cookie.slice(at + 1);
};

test("a tampered or missing cookie reads as null", async () => {
  const cookie = await signEidSession(session);
  assert.equal((await readEidSession(cookie))?.requestId, 1);
  assert.equal(await readEidSession(tamper(cookie)), null);
  assert.equal(await readEidSession(undefined), null);
});

test("public demo keys cannot forge a session, even if configured by an old installation", async () => {
  for (const secret of ["ordy-dev-secret-change-me", "change-me-to-a-long-random-string"]) {
    const forged = await new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30m")
      .sign(new TextEncoder().encode(secret));
    assert.equal(await readEidSession(forged), null);
    env.ORDY_SECRET = secret;
    assert.equal(await readEidSession(forged), null);
    assert.throws(() => signEidSession(session), /private ORDY_SECRET/);
  }
});

test("missing and short secrets disable sessions", () => {
  for (const secret of ["", "too-short", " ".repeat(40)]) {
    env.ORDY_SECRET = secret;
    assert.throws(() => signEidSession(session), /private ORDY_SECRET/);
  }
});

test("expired sessions and tokens without expiry are rejected", async () => {
  const key = new TextEncoder().encode(env.ORDY_SECRET);
  const expired = await new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("-1s").sign(key);
  const noExpiry = await new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setIssuedAt().sign(key);
  assert.equal(await readEidSession(expired), null);
  assert.equal(await readEidSession(noExpiry), null);
});

const transaction: LoginTransaction = {
  token: "demo-token",
  state: "Nj8Uq3Wv4tHVPcmXUbLzS0kZsNQ6ZhCl5Fq1Yd2WbEo",
  nonce: "q2Lw0SHUJ6pVb5tW7e9mXo3dAc1RfGyKzNi8sTuEvJ4",
  codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
};

test("a signed login transaction reads back unchanged", async () => {
  assert.deepEqual(await readLoginTransaction(await signLoginTransaction(transaction)), {
    token: "demo-token",
    state: "Nj8Uq3Wv4tHVPcmXUbLzS0kZsNQ6ZhCl5Fq1Yd2WbEo",
    nonce: "q2Lw0SHUJ6pVb5tW7e9mXo3dAc1RfGyKzNi8sTuEvJ4",
    codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  });
});

test("a tampered or missing login transaction reads as null", async () => {
  const cookie = await signLoginTransaction(transaction);
  assert.equal((await readLoginTransaction(cookie))?.token, "demo-token");
  assert.equal(await readLoginTransaction(tamper(cookie)), null);
  assert.equal(await readLoginTransaction(undefined), null);
});

test("a login transaction never reads as a session, nor a session as a login transaction", async () => {
  const signedTransaction = await signLoginTransaction(transaction);
  const signedSession = await signEidSession(session);
  assert.equal((await readLoginTransaction(signedTransaction))?.token, "demo-token");
  assert.equal((await readEidSession(signedSession))?.requestId, 1);
  assert.equal(await readEidSession(signedTransaction), null);
  assert.equal(await readLoginTransaction(signedSession), null);
});
