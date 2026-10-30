import assert from "node:assert/strict";
import { test } from "node:test";

import type { auditLog } from "@/server/db/schema";
import type { RequestState } from "./lifecycle";
import { pendingDecision } from "./pending";

type AuditRow = typeof auditLog.$inferSelect;

const request = (state: RequestState) => ({ state, given: "Eva", family: "Brandl", org: "Labor Kanalstraße", personNumber: "GH:mpWAk3kHzUqm2YVRVDNf4aDNQY0=" });

let nextId = 1;
const entry = (fields: Pick<AuditRow, "event" | "outcome"> & Partial<AuditRow>): AuditRow => ({
  id: nextId++,
  at: new Date("2026-10-28T10:00:00Z"),
  requestId: 5,
  actorKind: "network_member",
  actor: "@lena.hofer:klinikum.example",
  detail: {},
  ...fields,
});

const login = (name: string, held: { check: string; reason: string }[], at = "2026-10-28T13:41:00Z") =>
  entry({
    event: "identity_checked",
    outcome: "hold",
    at: new Date(at),
    actorKind: "outside_person",
    actor: `${name} (GH:mpWAk3kHzUqm2YVRVDNf4aDNQY0=)`,
    detail: {
      checks: [
        { check: "level", result: "pass", reason: "full" },
        ...held.map((c) => ({ ...c, result: "hold" })),
        { check: "person_number", result: "pass", reason: "no_binding" },
      ],
    },
  });

const heldAnswer = {
  sender: { givenName: "Eva", familyName: "Brandl", gdaOid: "1.2.40.0.34.3.2.99.1.2" },
  reason: "The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße.",
  sentAt: new Date("2026-10-29T16:23:40Z"),
};

test("an address mismatch is rebuilt from its audit entry", () => {
  const caught = entry({
    event: "misdelivery_caught",
    outcome: "address_mismatch",
    detail: { domain: "labor-kanai.example", expectedDomain: "labor-kanal.example" },
  });
  assert.deepEqual(pendingDecision(request("awaiting_confirmation"), [caught], null, false), {
    kind: "address",
    warning: "The address domain labor-kanai.example does not match Labor Kanalstraße (labor-kanal.example).",
    mismatch: { domain: "labor-kanai.example", expectedDomain: "labor-kanal.example" },
  });
});

test("an address the eHVD could not confirm has no mismatch", () => {
  assert.deepEqual(pendingDecision(request("awaiting_confirmation"), [], null, false), {
    kind: "address",
    warning: "The eHVD could not confirm the address, so the request has not been sent.",
    mismatch: null,
  });
});

test("an identity hold names the person and the check that held", () => {
  const cases = [
    [[{ check: "name", reason: "partial" }], "partial_name"],
    [[{ check: "name", reason: "requested_name_empty" }], "requested_name_empty"],
    [[{ check: "service", reason: "ehvd_unreachable" }], "ehvd_unreachable"],
    [[{ check: "name", reason: "partial" }, { check: "service", reason: "ehvd_unreachable" }], "partial_name"],
    [[{ check: "level", reason: "something_new" }], "unknown"],
  ] as const;
  for (const [held, reason] of cases) {
    assert.deepEqual(
      pendingDecision(request("identity_held"), [login("Petra Brandl", [...held])], null, false),
      { kind: "identity", person: "Petra Brandl", requested: "Eva Brandl", reason },
      reason,
    );
  }
});

test("the person to decide about is the first hold, not a later login", () => {
  const first = login("Petra Brandl", [{ check: "name", reason: "partial" }], "2026-10-28T13:41:00Z");
  const later = login("Eva Brandl-Huber", [{ check: "service", reason: "ehvd_unreachable" }], "2026-10-28T15:00:00Z");
  assert.deepEqual(pendingDecision(request("identity_held"), [later, first], null, false), {
    kind: "identity",
    person: "Petra Brandl",
    requested: "Eva Brandl",
    reason: "partial_name",
  });
});

test("a hold without a login, or no hold at all, still asks about the person", () => {
  const keycloakDown = entry({
    event: "identity_checked",
    outcome: "hold",
    actorKind: "anonymous",
    actor: "ID Austria login",
    detail: { checks: [{ check: "service", result: "hold", reason: "keycloak_unreachable" }] },
  });
  for (const audit of [[keycloakDown], []]) {
    assert.deepEqual(pendingDecision(request("identity_held"), audit, null, false), {
      kind: "identity",
      person: null,
      requested: "Eva Brandl",
      reason: "unknown",
    });
  }
});

test("a held answer names its sender and reason, and says when a filing is open", () => {
  const answer = {
    kind: "answer",
    sender: "Eva Brandl",
    reason: "The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße.",
    sentAt: new Date("2026-10-29T16:23:40Z"),
  };
  assert.deepEqual(pendingDecision(request("answer_held"), [], heldAnswer, false), { ...answer, filingOpen: false });
  assert.deepEqual(pendingDecision(request("answer_held"), [], heldAnswer, true), { ...answer, filingOpen: true });
  assert.equal(pendingDecision(request("answer_held"), [], null, false), null, "nothing held, nothing to file");
});

test("the other six states wait for nothing", () => {
  const caught = entry({ event: "misdelivery_caught", outcome: "address_mismatch", detail: { domain: "a.example", expectedDomain: "b.example" } });
  const audit = [caught, login("Petra Brandl", [{ check: "name", reason: "partial" }])];
  for (const state of ["sent", "verified", "filed", "cancelled", "expired", "locked"] as const) {
    assert.equal(pendingDecision(request(state), audit, heldAnswer, true), null, state);
  }
});
