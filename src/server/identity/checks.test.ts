import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  BASIC_FUNCTION,
  checkEhvdClaim,
  checkIdentity,
  checkLevel,
  checkName,
  checkPersonNumber,
  checkRequestPerson,
  FULL_FUNCTION,
  keycloakUnreachable,
  matchRequestedPerson,
} from "./checks";

// The table under "Name match" in docs/IDENTITY.md, read from the doc itself so the doc and the code cannot drift.
function nameMatchTable() {
  const doc = readFileSync(new URL("../../../docs/IDENTITY.md", import.meta.url), "utf8");
  const section = doc.slice(doc.indexOf("### Name match"), doc.indexOf("```ts", doc.indexOf("### Name match")));
  return section
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Dr. Hofer typed"))
    .map((line) => {
      const [typed, returned, result] = line.split("|").slice(1, 4).map((cell) => cell.trim());
      return { typed, returned, expected: result.split(/[.\s]/)[0].toLowerCase() };
    });
}

// Typed and returned names in the table are "<given names> <family name>".
const split = (name: string) => {
  const at = name.lastIndexOf(" ");
  return { given: name.slice(0, at), family: name.slice(at + 1) };
};

test("the name-match table in docs/IDENTITY.md", () => {
  const rows = nameMatchTable();
  assert.equal(rows.length, 8, "the table in the doc changed shape");
  for (const { typed, returned, expected } of rows) {
    const want = split(typed);
    const got = split(returned);
    assert.equal(matchRequestedPerson(want.given, want.family, got.given, got.family), expected, `${typed} vs ${returned}`);
    assert.equal(checkName(want, { givenName: got.given, familyName: got.family }).verdict, expected, `${typed} vs ${returned}`);
  }
});

test("a requested name without words never passes", () => {
  assert.deepEqual(checkName({ given: "-", family: "Brandl" }, { givenName: "Thomas", familyName: "Brandl" }), {
    check: "name",
    verdict: "hold",
    reason: "requested_name_empty",
  });
  // A title alone keeps its word (names.ts), so it holds as a partial match rather than passing.
  assert.equal(checkName({ given: "Dr.", family: "Brandl" }, { givenName: "Thomas", familyName: "Brandl" }).verdict, "hold");
});

test("a decomposed umlaut from the token matches the typed one", () => {
  // "Müller" in NFD: u followed by a combining diaeresis.
  const decomposed = { givenName: "Jürgen", familyName: "Müller" };
  assert.equal(checkName({ given: "Jürgen", family: "Müller" }, decomposed).verdict, "pass");
  assert.equal(checkName({ given: "Juergen", family: "Mueller" }, decomposed).verdict, "pass");
});

test("only full function passes the level check", () => {
  assert.equal(checkLevel(FULL_FUNCTION).verdict, "pass");
  assert.deepEqual(checkLevel(BASIC_FUNCTION), { check: "level", verdict: "fail", reason: "basic" });
  // A foreign eID through EU-Login carries no level.
  assert.deepEqual(checkLevel(undefined), { check: "level", verdict: "fail", reason: "missing" });
  assert.deepEqual(checkLevel(null), { check: "level", verdict: "fail", reason: "missing" });
  assert.deepEqual(checkLevel("urn:eidgvat:eid.status.FULL"), { check: "level", verdict: "fail", reason: "unknown" });
});

test("the person number binding", () => {
  assert.deepEqual(checkPersonNumber(null, "GH:a"), { check: "person_number", verdict: "pass", reason: "no_binding" });
  assert.deepEqual(checkPersonNumber("GH:a", "GH:a"), { check: "person_number", verdict: "pass", reason: "binding_matches" });
  assert.deepEqual(checkPersonNumber("GH:a", "GH:b"), { check: "person_number", verdict: "fail", reason: "binding_differs" });
  assert.deepEqual(checkPersonNumber(null, null), { check: "person_number", verdict: "fail", reason: "missing" });
});

test("a malformed eHVD claim fails, a missing one does not", () => {
  assert.equal(checkEhvdClaim(null).verdict, "pass");
  assert.equal(checkEhvdClaim("1.2.40.0.34.3.2.99.1.2").verdict, "pass");
  assert.deepEqual(checkEhvdClaim(new Error("bad")), { check: "ehvd_claim", verdict: "fail", reason: "malformed" });
});

const evaBrandl = {
  givenName: "Eva",
  familyName: "Brandl",
  personNumber: "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=",
  level: FULL_FUNCTION,
  gdaOid: "1.2.40.0.34.3.2.99.1.2",
};
const request1 = { given: "Eva", family: "Brandl" };

test("an unreachable service holds and never passes", () => {
  assert.deepEqual(keycloakUnreachable(), { verdict: "hold", checks: [{ check: "service", verdict: "hold", reason: "keycloak_unreachable" }] });
  // Everything else passes, the eHVD is down: still a hold.
  const result = checkIdentity({ requested: request1, login: evaBrandl, binding: null, unreachable: ["ehvd"] });
  assert.equal(result.verdict, "hold");
  // A fail still wins over an outage.
  const wagner = { ...evaBrandl, givenName: "Thomas", familyName: "Wagner" };
  assert.equal(checkIdentity({ requested: request1, login: wagner, binding: null, unreachable: ["ehvd"] }).verdict, "fail");
});

test("the request person: only the bound or accepted bPK passes", () => {
  assert.deepEqual(checkRequestPerson("GH:a", "GH:a"), { check: "request_person", verdict: "pass", reason: "same_person" });
  assert.deepEqual(checkRequestPerson("GH:a", "GH:b"), { check: "request_person", verdict: "fail", reason: "other_person" });
  assert.deepEqual(checkRequestPerson("GH:a", null), { check: "request_person", verdict: "fail", reason: "other_person" });
  assert.deepEqual(checkRequestPerson(null, "GH:a"), { check: "request_person", verdict: "fail", reason: "unbound" });
});

test("acceptance lifts a hold for the accepted person only, never a fail", () => {
  const petra = { ...evaBrandl, givenName: "Petra", personNumber: "GH:petra", gdaOid: null };
  const basicPetra = { ...petra, level: BASIC_FUNCTION };
  assert.equal(checkIdentity({ requested: request1, login: petra, binding: null }).verdict, "hold");
  assert.equal(checkIdentity({ requested: request1, login: petra, binding: null, bound: { personNumber: "GH:petra" } }).verdict, "pass");
  assert.equal(checkIdentity({ requested: request1, login: petra, binding: null, bound: { personNumber: "GH:other" } }).verdict, "fail");
  assert.equal(checkIdentity({ requested: request1, login: basicPetra, binding: null, bound: { personNumber: "GH:petra" } }).verdict, "fail");
});

test("a bound request without a person number fails closed", () => {
  // Even a full name match must not pass when the bound person is unknown.
  const result = checkIdentity({ requested: request1, login: evaBrandl, binding: null, bound: { personNumber: null } });
  assert.equal(result.verdict, "fail");
  assert.deepEqual(result.checks.at(-1), { check: "request_person", verdict: "fail", reason: "unbound" });
});

test("the second Eva Brandl fails once the first one is bound", () => {
  const second = { ...evaBrandl, personNumber: "GH:QqRyJqno/aFVJYjMxkWpDJWj878=", gdaOid: null };
  assert.equal(checkIdentity({ requested: request1, login: second, binding: null }).verdict, "pass");
  const bound = checkIdentity({ requested: request1, login: second, binding: evaBrandl.personNumber });
  assert.equal(bound.verdict, "fail");
  assert.deepEqual(
    bound.checks.find((c) => c.check === "person_number"),
    { check: "person_number", verdict: "fail", reason: "binding_differs" },
  );
  assert.equal(checkIdentity({ requested: request1, login: evaBrandl, binding: evaBrandl.personNumber }).verdict, "pass");
});
