import assert from "node:assert/strict";
import { test } from "node:test";

import type { auditLog } from "@/server/db/schema";
import type { RequestState } from "@/server/requests/lifecycle";

import { outsidePersonActor } from "./audit-actor";
import { checkText } from "./identity-check-text";
import { historyOf, identityAttempts, lastActivity, progressOf, stoppedUploads } from "./request-story";

type AuditRow = typeof auditLog.$inferSelect;
type Entry = [event: AuditRow["event"], outcome: string, detail?: Record<string, unknown>, actor?: string];

const hofer = "@lena.hofer:klinikum.example";
const browser = "ip 0123456789abcdef";
const eva = outsidePersonActor("Eva Brandl", "GH:eva");
const thomas = outsidePersonActor("Thomas Wagner", "GH:thomas");
const anna = outsidePersonActor("Anna Huber", "GH:anna");
const petra = outsidePersonActor("Petra Brandl", "GH:petra");

const KIND: Record<string, AuditRow["actorKind"]> = { [hofer]: "network_member", [browser]: "anonymous", ordy: "service" };
const start = Date.parse("2026-10-28T09:00:00.000Z");
const minute = (n: number) => new Date(start + n * 60_000).toISOString();

/** Audit rows with ids 1, 2, … one minute apart from 09:01 on. */
const story = (...entries: Entry[]): AuditRow[] =>
  entries.map(([event, outcome, detail = {}, actor = "ordy"], i) => ({
    id: i + 1,
    at: new Date(start + (i + 1) * 60_000),
    event,
    requestId: 1,
    actorKind: KIND[actor] ?? (actor === "ID Austria login" ? "anonymous" : "outside_person"),
    actor,
    outcome,
    detail,
  }));

const nameFail = { checks: [{ check: "name", result: "fail", reason: "no_shared_family_name" }] };
const passed = {
  checks: [
    { check: "level", result: "pass", reason: "full" },
    { check: "name", result: "pass", reason: "match" },
    { check: "person_number", result: "pass", reason: "no_binding" },
  ],
};
const sent = (address = "eva.brandl@labor-kanal.example", sentAnyway = false): Entry => [
  "request_sent", "sent", { docType: "lab-result", channel: "email", address, sentAnyway }, hofer,
];
const opened: Entry = ["link_opened", "shown", { state: "sent" }, browser];
const turnedAway = (actor: string): Entry[] => [
  ["identity_checked", "fail", nameFail, actor],
  ["misdelivery_caught", "wrong_person", nameFail, actor],
];
const mismatch: Entry = ["misdelivery_caught", "address_mismatch", { domain: "labor-kanaI.example", expectedDomain: "labor-kanal.example" }, hofer];

const request1 = { channel: "email", address: "eva.brandl@labor-kanal.example", org: "Labor Kanalstraße" } as const;
// Request 1 of the scenario: Thomas Wagner turned away (M2), Max's file stopped (M3), then Maria's file filed.
const request1Audit = story(
  sent(),
  opened,
  ...turnedAway(thomas),
  opened,
  ["identity_checked", "pass", passed, eva],
  ["answer_sent", "received", { sha256: "max", size: 900 }, eva],
  ["misdelivery_caught", "patient_mismatch", { sha256: "max", size: 900, nameMatches: false, birthDateMatches: false }, eva],
  ["answer_sent", "received", { sha256: "maria", size: 1200 }, eva],
  ["answer_filed", "filed", { resources: ["DiagnosticReport/1"], provenance: "Provenance/1", sha256: "maria" }],
);

const lines = (request: Parameters<typeof historyOf>[0], audit: AuditRow[]) =>
  historyOf(request, audit).map(({ id, text, tone }) => [id, text, tone]);

test("request 1's history reads newest first, with the turned-away login as one line", () => {
  assert.deepEqual(lines(request1, request1Audit), [
    [10, "Added to the patient record", "pass"],
    [9, "Eva Brandl sent a document", "none"],
    [8, "Blocked. The document was about a different patient. Nothing was saved.", "fail"],
    [7, "Eva Brandl sent a document", "none"],
    [6, "Eva Brandl confirmed who they are with ID Austria", "pass"],
    [5, "Someone opened the link", "none"],
    [4, "Blocked. Thomas Wagner is not the person you asked for.", "fail"],
    [2, "Someone opened the link", "none"],
    [1, "Sent by email to eva.brandl@labor-kanal.example", "pass"],
  ]);
});

test("the M1 request's history shows the held address, Send anyway, and the turned-away login", () => {
  const request3 = { ...request1, address: "eva.brandl@labor-kanaI.example" };
  const audit = story(mismatch, sent(request3.address, true), opened, ...turnedAway(anna));
  assert.deepEqual(lines(request3, audit), [
    [5, "Blocked. Anna Huber is not the person you asked for.", "fail"],
    [3, "Someone opened the link", "none"],
    [2, "Sent by email to eva.brandl@labor-kanaI.example after you confirmed the address", "pass"],
    [1, "Held back. The address domain labor-kanaI.example does not belong to Labor Kanalstraße.", "hold"],
  ]);
});

test("a failed login keeps its own line when no wrong_person of the same actor follows it", () => {
  const audit = story(["identity_checked", "fail", nameFail, thomas], ["misdelivery_caught", "wrong_person", nameFail, anna]);
  assert.deepEqual(lines(request1, audit), [
    [2, "Blocked. Anna Huber is not the person you asked for.", "fail"],
    [1, "Thomas Wagner logged in and was turned away", "fail"],
  ]);
});

test("holds, decisions, refused links, and SMS read as their sentences", () => {
  const request2 = { channel: "sms", address: "+43 660 000 0101", org: "Reha Waldblick" } as const;
  const audit = story(
    ["request_sent", "sent", { docType: "rehab-report", channel: "sms", address: request2.address, sentAnyway: false }, hofer],
    ["identity_checked", "hold", { checks: [{ check: "service", result: "hold", reason: "keycloak_unreachable" }] }, "ID Austria login"],
    ["identity_checked", "hold", { checks: [{ check: "name", result: "hold", reason: "partial" }] }, petra],
    ["request_decided", "accepted", { from: "identity_held", to: "verified" }, hofer],
    ["request_decided", "accepted", { from: "answer_held", to: "filed" }, hofer],
    ["answer_filed", "filed", { resources: ["DocumentReference/2"], provenance: "Provenance/2", sha256: "x", acceptedBy: hofer }],
    ["request_decided", "rejected", { from: "identity_held", to: "cancelled" }, hofer],
    ["request_decided", "rejected", { from: "answer_held", to: "cancelled" }, hofer],
    ["request_decided", "cancelled", { from: "sent", to: "cancelled" }, hofer],
    ["link_opened", "refused", { state: "cancelled" }, browser],
    ["request_decided", "accepted", {}, hofer],
  );
  assert.deepEqual(lines(request2, audit).reverse(), [
    [1, "Sent by SMS to +43 660 000 0101", "pass"],
    [2, "A login could not be finished, because ID Austria could not be reached", "hold"],
    [3, "Petra Brandl logged in and needs your check", "hold"],
    [4, "You accepted the person", "pass"],
    [5, "You accepted the document", "pass"],
    [6, "Added to the patient record after you accepted it", "pass"],
    [7, "You rejected the person", "none"],
    [8, "You rejected the document", "none"],
    [9, "You cancelled the request", "none"],
    [10, "Someone opened the link after it stopped working", "none"],
    [11, "Unreadable audit entry: request_decided, accepted", "none"],
  ]);
});

test("progress has the expected five statuses in each of the nine states", () => {
  const stories: Record<RequestState, AuditRow[]> = {
    awaiting_confirmation: story(mismatch),
    sent: story(sent()),
    identity_held: story(sent(), opened, ["identity_checked", "hold", { checks: [{ check: "name", result: "hold", reason: "partial" }] }, petra]),
    verified: story(sent(), opened, ["identity_checked", "pass", passed, eva]),
    answer_held: story(sent(), opened, ["identity_checked", "pass", passed, eva], ["answer_sent", "received", { sha256: "kidney", size: 800 }, eva]),
    filed: request1Audit,
    cancelled: story(sent(), ["request_decided", "cancelled", { from: "sent", to: "cancelled" }, hofer]),
    expired: story(sent(), opened),
    locked: story(sent(), opened, ...turnedAway(thomas), opened, ...turnedAway(thomas), opened, ...turnedAway(thomas)),
  };
  const statuses = Object.fromEntries(
    Object.entries(stories).map(([state, audit]) => [state, progressOf(state as RequestState, audit).map((step) => step.status)]),
  );
  assert.deepEqual(statuses, {
    awaiting_confirmation: ["held", "todo", "todo", "todo", "todo"],
    sent: ["done", "current", "todo", "todo", "todo"],
    identity_held: ["done", "done", "held", "todo", "todo"],
    verified: ["done", "done", "done", "current", "todo"],
    answer_held: ["done", "done", "done", "done", "held"],
    filed: ["done", "done", "done", "done", "done"],
    cancelled: ["done", "todo", "todo", "todo", "todo"],
    expired: ["done", "done", "todo", "todo", "todo"],
    locked: ["done", "done", "blocked", "todo", "todo"],
  });
});

test("request 1's progress names when each step was done and what was stopped on the way", () => {
  assert.deepEqual(
    progressOf("filed", request1Audit).map(({ key, label, status, at, note }) => [key, label, status, at?.toISOString() ?? null, note]),
    [
      ["sent", "Sent", "done", minute(1), null],
      ["opened", "Opened", "done", minute(2), null],
      ["confirmed", "Sender confirmed", "done", minute(6), "1 login turned away"],
      ["answered", "Answered", "done", minute(9), "1 upload stopped"],
      ["received", "Received", "done", minute(10), null],
    ],
  );
});

test("a stopped upload alone does not answer, and a sender Dr. Hofer accepted counts as confirmed", () => {
  const audit = story(
    sent(),
    opened,
    ["identity_checked", "hold", { checks: [{ check: "name", result: "hold", reason: "partial" }] }, petra],
    ["request_decided", "accepted", { from: "identity_held", to: "verified" }, hofer],
    ["answer_sent", "received", { sha256: "max", size: 900 }, petra],
    ["misdelivery_caught", "patient_mismatch", { sha256: "max", size: 900, nameMatches: false, birthDateMatches: true }, petra],
  );
  assert.deepEqual(
    progressOf("verified", audit).map(({ key, status, at, note }) => [key, status, at?.toISOString() ?? null, note]),
    [
      ["sent", "done", minute(1), null],
      ["opened", "done", minute(2), null],
      ["confirmed", "done", minute(4), null],
      ["answered", "current", null, "1 upload stopped"],
      ["received", "todo", null, null],
    ],
  );
});

test("each login's checks parse into sentences, without checks this version does not know", () => {
  const audit = [
    ...request1Audit,
    ...story(["identity_checked", "hold", {
      checks: [
        { check: "service", result: "hold", reason: "keycloak_unreachable" },
        { check: "retina", result: "pass", reason: "match" },
        { check: "level", result: "pass", reason: "match" },
      ],
    }, "ID Austria login"]).map((row) => ({ ...row, id: 11, at: new Date(minute(11)) })),
  ];
  assert.deepEqual(
    identityAttempts(audit).map(({ id, at, person, verdict, checks }) => [id, at.toISOString(), person, verdict, checks.map(checkText)]),
    [
      [3, minute(3), "Thomas Wagner", "fail", ["The family name is different."]],
      [
        6,
        minute(6),
        "Eva Brandl",
        "pass",
        ["The ID Austria login has full function.", "The name matches the person you asked for.", "First answer from this person at this organisation."],
      ],
      [11, minute(11), null, "hold", ["ID Austria could not be reached."]],
    ],
  );
});

test("the last activity is the newest audit entry, or the creation without one", () => {
  const createdAt = new Date(minute(0));
  assert.equal(lastActivity({ createdAt, audit: request1Audit }).toISOString(), minute(10));
  assert.equal(lastActivity({ createdAt, audit: [] }).toISOString(), minute(0));
});

test("stopped uploads count the patient mismatches", () => {
  assert.equal(stoppedUploads(request1Audit), 1);
  assert.equal(stoppedUploads(story(sent(), opened)), 0);
});
