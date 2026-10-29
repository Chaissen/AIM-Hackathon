import assert from "node:assert/strict";
import { test } from "node:test";

import { sessionFromClaims } from "./id-austria";

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

const evaWithout = (claim: keyof typeof eva) => Object.fromEntries(Object.entries(eva).filter(([name]) => name !== claim));

test("Eva Brandl's claims become her session for the request", () => {
  assert.deepEqual(sessionFromClaims(eva, 7), {
    requestId: 7,
    personNumber: "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=",
    givenName: "Eva",
    familyName: "Brandl",
    level: "urn:eidgvat:eid.status.full",
    gdaOid: "1.2.40.0.34.3.2.99.1.2",
  });
});

test("claims without a bPK fail even with a sub", () => {
  assert.ok(sessionFromClaims(evaWithout("urn:pvpgvat:oidc.bpk"), 7) instanceof Error);
});

test("a malformed eHVD entry fails the login instead of reading as no entry", () => {
  assert.ok(sessionFromClaims({ ...eva, "urn:eidgvat:attributes.gda": "not base64!" }, 7) instanceof Error);
  assert.ok(sessionFromClaims({ ...eva, "urn:eidgvat:attributes.gda": null }, 7) instanceof Error);
});

test("a missing level reads as null and an unknown one fails", () => {
  assert.deepEqual(sessionFromClaims(evaWithout("urn:pvpgvat:oidc.eid_ida_level"), 7), {
    requestId: 7,
    personNumber: "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=",
    givenName: "Eva",
    familyName: "Brandl",
    level: null,
    gdaOid: "1.2.40.0.34.3.2.99.1.2",
  });
  assert.ok(sessionFromClaims({ ...eva, "urn:pvpgvat:oidc.eid_ida_level": "urn:eidgvat:eid.status.unknown" }, 7) instanceof Error);
});
