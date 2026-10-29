import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialState,
  isOpen,
  linkIsLive,
  OPEN_STATES,
  REQUEST_STATES,
  type RequestEvent,
  type RequestState,
  taskStatus,
  transition,
  TransitionError,
} from "./lifecycle";

// One row per line of the event table in docs/ARCHITECTURE.md, "Request lifecycle".
const DOCUMENTED: [string, RequestState, RequestEvent, RequestState][] = [
  ["Send anyway", "awaiting_confirmation", "send_anyway", "sent"],
  ["identity check passes", "sent", "identity_pass", "verified"],
  ["the verified person logs in again", "verified", "identity_pass", "verified"],
  ["identity check matches the name partly", "sent", "identity_hold", "identity_held"],
  ["Accept a held identity", "identity_held", "accept", "verified"],
  ["answer passes the patient check, role confirmed", "verified", "answer_confirmed", "filed"],
  ["answer passes the patient check, role not confirmed", "verified", "answer_unconfirmed", "answer_held"],
  ["answer fails the patient check", "verified", "patient_mismatch", "verified"],
  ["Accept a held answer", "answer_held", "accept", "filed"],
  ["Reject a held identity", "identity_held", "reject", "cancelled"],
  ["Reject a held answer", "answer_held", "reject", "cancelled"],
  ...OPEN_STATES.map((s): [string, RequestState, RequestEvent, RequestState] => [`Cancel in ${s}`, s, "cancel", "cancelled"]),
  ...OPEN_STATES.map((s): [string, RequestState, RequestEvent, RequestState] => [`7 days pass in ${s}`, s, "expire", "expired"]),
];

for (const [label, from, event, to] of DOCUMENTED) {
  test(`${label}: ${from} --${event}--> ${to}`, () => {
    assert.equal(transition(from, event), to);
  });
}

test("the address check picks the first state", () => {
  assert.equal(initialState(true), "sent");
  assert.equal(initialState(false), "awaiting_confirmation");
});

test("the first two failed identity checks keep the state, the third locks the link", () => {
  for (const state of ["sent", "verified"] as const) {
    assert.equal(transition(state, "identity_fail", 1), state);
    assert.equal(transition(state, "identity_fail", 2), state);
    assert.equal(transition(state, "identity_fail", 3), "locked");
  }
});

test("every other state and event pair is refused", () => {
  const allowed = new Set([...DOCUMENTED.map(([, from, event]) => `${from} ${event}`), "sent identity_fail", "verified identity_fail"]);
  const events = [...new Set(DOCUMENTED.map(([, , event]) => event)), "identity_fail"] as RequestEvent[];
  let refused = 0;
  for (const from of REQUEST_STATES) {
    for (const event of events) {
      if (allowed.has(`${from} ${event}`)) continue;
      assert.throws(() => transition(from, event), TransitionError, `${from} ${event}`);
      refused++;
    }
  }
  assert.ok(refused > 0);
});

test("filed, cancelled, expired, and locked are final", () => {
  for (const state of ["filed", "cancelled", "expired", "locked"] as const) {
    assert.equal(isOpen(state), false, state);
    assert.throws(() => transition(state, "cancel"), TransitionError, state);
  }
});

test("the link works only once it went out and while the request is open", () => {
  const live = REQUEST_STATES.filter(linkIsLive);
  assert.deepEqual(live, ["sent", "identity_held", "verified", "answer_held"]);
});

test("the FHIR Task status mirrors each state", () => {
  assert.deepEqual(Object.fromEntries(REQUEST_STATES.map((s) => [s, taskStatus(s)])), {
    awaiting_confirmation: "draft",
    sent: "requested",
    identity_held: "on-hold",
    verified: "in-progress",
    answer_held: "on-hold",
    filed: "completed",
    cancelled: "cancelled",
    expired: "failed",
    locked: "failed",
  });
});
