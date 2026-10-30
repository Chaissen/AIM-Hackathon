import assert from "node:assert/strict";
import { test } from "node:test";

import { accepts, OPEN_STATES, REQUEST_STATES } from "@/server/requests/lifecycle";

import { countByFilter, inFilter, REQUEST_FILTERS, STATUS } from "./request-status";

test("every state has its label, tone, and bucket", () => {
  assert.deepEqual(
    REQUEST_STATES.map((state) => [state, STATUS[state].label, STATUS[state].tone, STATUS[state].bucket]),
    [
      ["awaiting_confirmation", "Check address", "warning", "attention"],
      ["sent", "Waiting for reply", "outline", "waiting"],
      ["identity_held", "Confirm sender", "warning", "attention"],
      ["verified", "Sender confirmed", "outline", "waiting"],
      ["answer_held", "Review answer", "warning", "attention"],
      ["filed", "Received", "success", "received"],
      ["cancelled", "Cancelled", "secondary", "closed"],
      ["expired", "Expired", "secondary", "closed"],
      ["locked", "Locked", "destructive", "closed"],
    ],
  );
});

test("the Open filter holds exactly the open states of the lifecycle", () => {
  assert.deepEqual(REQUEST_STATES.filter((state) => inFilter(state, "open")), [...OPEN_STATES]);
});

test("the attention states are the open states that take Send anyway or Accept", () => {
  const attention = REQUEST_STATES.filter((state) => inFilter(state, "attention"));
  assert.deepEqual(attention, ["awaiting_confirmation", "identity_held", "answer_held"]);
  assert.deepEqual(attention, OPEN_STATES.filter((state) => accepts(state, "send_anyway") || accepts(state, "accept")));
});

test("All holds every state, and each other filter only its own bucket", () => {
  assert.deepEqual(
    REQUEST_FILTERS.map((filter) => [filter, REQUEST_STATES.filter((state) => inFilter(state, filter))]),
    [
      ["all", [...REQUEST_STATES]],
      ["open", ["awaiting_confirmation", "sent", "identity_held", "verified", "answer_held"]],
      ["attention", ["awaiting_confirmation", "identity_held", "answer_held"]],
      ["received", ["filed"]],
      ["closed", ["cancelled", "expired", "locked"]],
    ],
  );
});

test("the seeded requests 1 to 11 count as the request tabs show them", () => {
  const seeded = [
    "filed", "filed", "sent", "awaiting_confirmation", "identity_held", "answer_held",
    "sent", "verified", "cancelled", "expired", "locked",
  ] as const;
  assert.deepEqual(countByFilter(seeded), { all: 11, open: 6, attention: 3, received: 2, closed: 3 });
  assert.deepEqual(countByFilter([]), { all: 0, open: 0, attention: 0, received: 0, closed: 0 });
});
