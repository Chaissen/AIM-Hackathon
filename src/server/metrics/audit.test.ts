import assert from "node:assert/strict";
import { test } from "node:test";

import {
  auditCoverage,
  bestCoverage,
  coverageLines,
  effortSeconds,
  filedReferences,
  misdeliveryCaught,
  missingFields,
  requestCoverage,
  type AuditRow,
} from "./audit";

let nextId = 1;
const row = (r: Partial<AuditRow> & Pick<AuditRow, "event" | "at">): AuditRow => ({
  id: nextId++,
  requestId: 1,
  actorKind: "service",
  actor: "ordy",
  outcome: "ok",
  detail: {},
  ...r,
});
const at = (time: string) => new Date(`2026-10-29T${time}Z`);

// Request 1 as the scenario runs it: M2 opens the link first, then Dr. Brandl answers with the wrong patient (M3), then right.
const request1: AuditRow[] = [
  row({ event: "request_sent", at: at("13:00:00"), actorKind: "network_member", actor: "@lena.hofer:klinikum.example", outcome: "sent", detail: { docType: "lab-result", channel: "email" } }),
  row({ event: "link_opened", at: at("13:05:00"), actorKind: "anonymous", actor: "ip:3f2a", outcome: "ok" }),
  row({ event: "identity_checked", at: at("13:05:30"), actorKind: "outside_person", actor: "Thomas Wagner", outcome: "fail" }),
  row({ event: "misdelivery_caught", at: at("13:05:30"), actorKind: "outside_person", actor: "Thomas Wagner", outcome: "wrong_person" }),
  row({ event: "link_opened", at: at("14:00:00"), actorKind: "anonymous", actor: "ip:9c1d", outcome: "ok" }),
  row({ event: "identity_checked", at: at("14:00:40"), actorKind: "outside_person", actor: "Eva Brandl", outcome: "pass" }),
  row({ event: "answer_sent", at: at("14:01:25"), actorKind: "outside_person", actor: "Eva Brandl", outcome: "received", detail: { sha256: "ab12", size: 1834 } }),
  row({ event: "misdelivery_caught", at: at("14:01:26"), actorKind: "service", actor: "ordy", outcome: "patient_mismatch" }),
  row({ event: "answer_sent", at: at("14:02:10"), actorKind: "outside_person", actor: "Eva Brandl", outcome: "received" }),
  row({
    event: "answer_filed",
    at: at("14:02:12"),
    outcome: "filed",
    detail: {
      resources: ["DiagnosticReport/12", "Observation/13/_history/1", "Observation/14", "Practitioner/9"],
      provenance: "Provenance/15",
      task: "Task/8",
    },
  }),
];

test("who, what, and when must each be present", () => {
  assert.deepEqual(missingFields(request1[0]), []);
  assert.deepEqual(missingFields({ ...request1[0], actor: " " }), ["who"]);
  assert.deepEqual(missingFields({ ...request1[0], outcome: "" }), ["what"]);
  assert.deepEqual(missingFields({ ...request1[0], at: new Date("not a date") }), ["when"]);
});

test("request 1 covers all six event types", () => {
  const c = requestCoverage(1, request1);
  assert.equal(c.covered, 6);
  assert.deepEqual(
    c.events.map((e) => [e.event, e.entries]),
    [
      ["request_sent", 1],
      ["link_opened", 2],
      ["identity_checked", 2],
      ["answer_sent", 2],
      ["answer_filed", 1],
      ["misdelivery_caught", 2],
    ],
  );
  assert.ok(coverageLines(c).every((line) => !line.includes("MISS")));
});

test("an event type with only incomplete entries does not count, and a missing one is listed", () => {
  const rows = [
    row({ event: "request_sent", at: at("09:00:00"), requestId: 2, actor: "@lena.hofer:klinikum.example" }),
    row({ event: "link_opened", at: at("09:01:00"), requestId: 2, actor: "" }),
  ];
  const c = requestCoverage(2, rows);
  assert.equal(c.covered, 1);
  const linkOpened = c.events.find((e) => e.event === "link_opened")!;
  assert.deepEqual([linkOpened.entries, linkOpened.complete, linkOpened.missing], [1, 0, ["who"]]);
  const lines = coverageLines(c);
  assert.match(lines[0], /^Request 2: 1 of 6/);
  assert.match(lines.find((l) => l.includes("link_opened"))!, /MISS.*missing: who/);
  assert.match(lines.find((l) => l.includes("answer_filed"))!, /MISS.*no entry/);
});

test("coverage per request ignores rows without a request and picks the best request", () => {
  const rows = [...request1, row({ event: "request_sent", at: at("15:00:00"), requestId: 2 }), row({ event: "link_opened", at: at("15:00:00"), requestId: null })];
  const coverage = auditCoverage(rows);
  assert.deepEqual(
    coverage.map((c) => [c.requestId, c.covered]),
    [
      [1, 6],
      [2, 1],
    ],
  );
  assert.equal(bestCoverage(coverage)?.requestId, 1);
  assert.equal(bestCoverage([]), undefined);
});

test("effort runs from the last link opening before the first answer to that answer", () => {
  // Dr. Brandl opened at 14:00:00 and first sent at 14:01:25. The colleague's opening at 13:05 does not count.
  assert.equal(effortSeconds(request1, 1), 85);
  assert.equal(effortSeconds(request1.filter((r) => r.event !== "answer_sent"), 1), null);
  assert.equal(effortSeconds(request1, 2), null);
});

test("misdeliveries are found by kind, in the outcome or in detail.kind", () => {
  assert.equal(misdeliveryCaught(request1, 1, "wrong_person")?.actor, "Thomas Wagner");
  assert.equal(misdeliveryCaught(request1, 1, "patient_mismatch")?.outcome, "patient_mismatch");
  assert.equal(misdeliveryCaught(request1, 1, "address_mismatch"), undefined);
  assert.equal(misdeliveryCaught(request1, 1, "wrong_person", at("14:00:00")), undefined);
  const inDetail = row({ event: "misdelivery_caught", at: at("16:00:00"), requestId: 3, outcome: "caught", detail: { kind: "address_mismatch" } });
  assert.equal(misdeliveryCaught([inDetail], 3, "address_mismatch"), inDetail);
});

test("filed references come from answer_filed entries only, without history and duplicates", () => {
  const again = row({ event: "answer_filed", at: at("14:03:00"), outcome: "filed", detail: { resources: ["Observation/14", "DocumentReference/20"] } });
  const notFiled = row({ event: "answer_sent", at: at("14:04:00"), detail: { resource: "Observation/99" } });
  assert.deepEqual(filedReferences([...request1, again, notFiled]), [
    "DiagnosticReport/12",
    "Observation/13",
    "Observation/14",
    "Practitioner/9",
    "Provenance/15",
    "Task/8",
    "DocumentReference/20",
  ]);
  const odd = row({ event: "answer_filed", at: at("14:05:00"), detail: { note: "filed fine", ids: { nested: ["Observation/abc-1"] }, url: "http://x/Observation/1" } });
  assert.deepEqual(filedReferences([odd]), ["Observation/abc-1"]);
});
