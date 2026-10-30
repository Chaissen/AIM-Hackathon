import assert from "node:assert/strict";
import { test } from "node:test";

import { loginFromClaims } from "./id-austria";

const eva = {
  iss: "http://localhost:8080/realms/idaustria-sim",
  aud: "request-service",
  sub: "5b0f0a6e-1d3c-4c55-9a51-7c1d2c6f9e10",
  given_name: "Eva",
  family_name: "Brandl",
  birthdate: "1979-05-14",
  "urn:pvpgvat:oidc.bpk": "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=",
  "urn:pvpgvat:oidc.eid_ida_level": "urn:eidgvat:eid.status.full",
  "urn:pvpgvat:oidc.eid_citizen_qaa_eidas_level": "http://eidas.europa.eu/LoA/high",
  "urn:pvpgvat:oidc.eid_identity_status_level": "http://eid.gv.at/eID/status/testidentity",
  "urn:pvpgvat:oidc.pvp_version": "2.2",
  "urn:eidgvat:attributes.gda":
    "eyJnZGEiOnsiaWQiOnsib2lkSXNzdWluZ0F1dGhvcml0eSI6IjEuMi40MC4wLjM0IiwiaWQiOiIxLjIuNDAuMC4zNC4zLjIuOTkuMS4yIn0sInN0YXR1cyI6eyJlaHZkc3RhdHVzIjoiQWt0aXYiLCJlbGdhc3RhdHVzIjoiQWt0aXYifSwiZmlyc3RuYW1lIjoiRXZhIiwic3VybmFtZSI6IkJyYW5kbCIsInRpdGxlIjoiRHIuIiwiZGVzY3JpcHRpb24iOlsiUmVnaXN0cmllcnVuZ3NzdGVsbGU6w5ZzdGVycmVpY2hpc2NoZSDDhHJ6dGVrYW1tZXIiXSwicm9sZXMiOnsicm9sZSI6WyIxLjIuNDAuMC4zNC41LjI6MTU5Il0sImVsZ2FSb2xlIjpbIjEuMi40MC4wLjM0LjUuMzo3MDAiXSwic3BlY2lhbGlzYXRpb24iOlsiMS4yLjQwLjAuMzQuMy4xLjEwLjIwOjE5Il19LCJ0aW1lc3RhbXBzIjp7ImFkZCI6IjIwMTktMDMtMDEiLCJtb2RpZnkiOiIyMDI2LTAxLTE1In19fQ==",
};

const evaWithout = (...claims: (keyof typeof eva)[]) => {
  const dropped = new Set<string>(claims);
  return Object.fromEntries(Object.entries(eva).filter(([name]) => !dropped.has(name)));
};

test("Eva Brandl's claims become the login the identity checks read", () => {
  assert.deepEqual(loginFromClaims(eva), {
    givenName: "Eva",
    familyName: "Brandl",
    personNumber: "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=",
    level: "urn:eidgvat:eid.status.full",
    gdaOid: "1.2.40.0.34.3.2.99.1.2",
  });
});

test("claims without a bPK have no person number even with a sub", () => {
  const login = loginFromClaims(evaWithout("urn:pvpgvat:oidc.bpk"));
  assert.ok(!(login instanceof Error));
  assert.equal(login.personNumber, null);
});

test("a malformed eHVD entry reads as an error, never as no entry", () => {
  for (const gda of ["not base64!", null]) {
    const login = loginFromClaims({ ...eva, "urn:eidgvat:attributes.gda": gda });
    assert.ok(!(login instanceof Error));
    assert.ok(login.gdaOid instanceof Error);
  }
});

test("the level stays as received for the level check", () => {
  const unknown = loginFromClaims({ ...eva, "urn:pvpgvat:oidc.eid_ida_level": "urn:eidgvat:eid.status.unknown" });
  assert.ok(!(unknown instanceof Error));
  assert.equal(unknown.level, "urn:eidgvat:eid.status.unknown");
});

test("claims without a level or an eHVD entry still reach the checks", () => {
  const login = loginFromClaims(evaWithout("urn:pvpgvat:oidc.eid_ida_level", "urn:eidgvat:attributes.gda"));
  assert.ok(!(login instanceof Error));
  assert.equal(login.level, undefined);
  assert.equal(login.gdaOid, null);
});

test("claims without a name fail the login", () => {
  assert.ok(loginFromClaims(evaWithout("family_name")) instanceof Error);
});
