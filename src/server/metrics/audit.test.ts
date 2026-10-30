import assert from "node:assert/strict";
import { test } from "node:test";

import type { DocumentType } from "@/lib/document-types";

import {
  auditCoverage,
  bestCoverage,
  coverageLines,
  effortLines,
  effortSeconds,
  effortSpan,
  filedReferences,
  latestRequest1,
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

const checks = (result: "pass" | "fail") => ({ checks: [{ check: "name", result, reason: "The ID Austria name matches the request." }] });
const thomas = { actorKind: "outside_person" as const, actor: "Thomas Wagner (bpk-thomas)" };
const eva = { actorKind: "outside_person" as const, actor: "Eva Brandl (bpk-eva)" };

// Request 1 as the scenario runs it, with the outcomes and details of recordAudit() (#32) and the login checks (#34):
// M2 opens the link first, then Dr. Brandl answers with the wrong patient (M3), then with the right one.
const request1: AuditRow[] = [
  row({
    event: "request_sent",
    at: at("13:00:00"),
    actorKind: "network_member",
    actor: "@lena.hofer:klinikum.example",
    outcome: "sent",
    detail: { docType: "lab-result", channel: "email", address: "eva.brandl@labor-kanal.example" },
  }),
  row({ event: "link_opened", at: at("13:05:00"), actorKind: "anonymous", actor: "ip 3f2a", outcome: "shown", detail: { state: "sent" } }),
  row({ event: "identity_checked", at: at("13:05:30"), ...thomas, outcome: "fail", detail: checks("fail") }),
  row({ event: "misdelivery_caught", at: at("13:05:30"), ...thomas, outcome: "wrong_person", detail: checks("fail") }),
  row({ event: "link_opened", at: at("14:00:00"), actorKind: "anonymous", actor: "ip 9c1d", outcome: "shown", detail: { state: "sent" } }),
  row({ event: "identity_checked", at: at("14:00:40"), ...eva, outcome: "pass", detail: checks("pass") }),
  row({ event: "answer_sent", at: at("14:01:25"), ...eva, outcome: "received", detail: { sha256: "ab12", size: 1834 } }),
  row({
    event: "misdelivery_caught",
    at: at("14:01:26"),
    ...eva,
    outcome: "patient_mismatch",
    detail: { sha256: "ab12", size: 1834, nameMatches: false, birthDateMatches: false },
  }),
  row({ event: "answer_sent", at: at("14:02:10"), ...eva, outcome: "received", detail: { sha256: "cd34", size: 1790 } }),
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

test("who, the outcome, the detail fields of the event, and when must each be present", () => {
  assert.deepEqual(missingFields(request1[0]), []);
  assert.deepEqual(missingFields({ ...request1[0], actor: " " }), ["who"]);
  assert.deepEqual(missingFields({ ...request1[0], outcome: "" }), ["outcome"]);
  assert.deepEqual(missingFields({ ...request1[0], at: new Date("not a date") }), ["when"]);
  assert.deepEqual(missingFields({ ...request1[0], detail: { docType: "lab-result", channel: "", address: "x" } }), ["detail.channel"]);
  // answer_sent needs the hash and a numeric size.
  assert.deepEqual(missingFields({ ...request1[6], detail: { sha256: "ab12", size: "1834" } }), ["detail.size"]);
  // identity_checked and answer_filed need non-empty lists.
  assert.deepEqual(missingFields({ ...request1[2], detail: { checks: [] } }), ["detail.checks"]);
  assert.deepEqual(missingFields({ ...request1[9], detail: { resources: [], provenance: "Provenance/15" } }), ["detail.resources"]);
});

test("a misdelivery needs a known kind as outcome and the detail fields of that kind", () => {
  const mismatch = request1[7];
  assert.deepEqual(missingFields(mismatch), []);
  assert.deepEqual(missingFields({ ...mismatch, detail: { sha256: "ab12", size: 1834 } }), ["detail.nameMatches", "detail.birthDateMatches"]);
  assert.deepEqual(missingFields({ ...mismatch, outcome: "caught" }), ["outcome"]);
  assert.deepEqual(missingFields({ ...mismatch, outcome: "" }), ["outcome"]);
  const address = row({ event: "misdelivery_caught", at: at("12:00:00"), outcome: "address_mismatch", detail: { domain: "labor-kanai.example" } });
  assert.deepEqual(missingFields(address), ["detail.expectedDomain"]);
});

test("six entries without their detail fields cover nothing", () => {
  const bare = request1.map((r) => ({ ...r, detail: {} }));
  const c = requestCoverage(1, bare);
  assert.equal(c.covered, 0);
  assert.deepEqual(c.events.find((e) => e.event === "answer_sent")?.missing, ["detail.sha256", "detail.size"]);
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
    { ...request1[0], id: 900, requestId: 2 },
    row({ event: "link_opened", at: at("09:01:00"), requestId: 2, actor: "", outcome: "shown", detail: { state: "sent" } }),
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
  const rows = [...request1, { ...request1[0], id: 901, requestId: 2 }, { ...request1[1], id: 902, requestId: null }];
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

test("effort runs from the person's link opening to the answer that was filed", () => {
  // Dr. Brandl opened at 14:00:00. Her first upload (M3, 14:01:25) was rejected; the filed one was sent at 14:02:10.
  // The colleague's opening at 13:05 does not count.
  assert.equal(effortSeconds(request1, 1), 130);
  assert.equal(effortSeconds(request1, 2), null);
});

test("a rejected upload does not stop the clock", () => {
  const s = (seconds: number) => new Date(Date.UTC(2026, 9, 29, 14, 0, seconds));
  const rows = [
    row({ event: "link_opened", at: s(30) }),
    row({ event: "answer_sent", at: s(50) }),
    row({ event: "misdelivery_caught", at: s(51), outcome: "patient_mismatch" }),
    row({ event: "answer_sent", at: new Date(s(0).getTime() + 170_000) }),
    row({ event: "answer_filed", at: new Date(s(0).getTime() + 171_000) }),
  ];
  assert.equal(effortSeconds(rows, 1), 140);
  // Until an answer is filed there is no effort to measure.
  assert.equal(effortSeconds(rows.slice(0, 4), 1), null);
});

test("misdeliveries are found by the kind in the outcome", () => {
  assert.equal(misdeliveryCaught(request1, 1, "wrong_person")?.actor, thomas.actor);
  assert.equal(misdeliveryCaught(request1, 1, "patient_mismatch")?.outcome, "patient_mismatch");
  assert.equal(misdeliveryCaught(request1, 1, "address_mismatch"), undefined);
  assert.equal(misdeliveryCaught(request1, 1, "wrong_person", at("14:00:00")), undefined);
  const inDetailOnly = row({ event: "misdelivery_caught", at: at("16:00:00"), requestId: 3, outcome: "caught", detail: { kind: "address_mismatch" } });
  assert.equal(misdeliveryCaught([inDetailOnly], 3, "address_mismatch"), undefined);
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

test("the effort span names the opening that starts the clock and the upload that was filed", () => {
  const span = effortSpan(request1, 1)!;
  assert.equal(span.opened, request1[4]);
  assert.equal(span.sent, request1[8]);
  assert.equal(effortSpan(request1.slice(0, 9), 1), undefined);
});

test("the newest request 1 goes to Dr. Brandl's exact address", () => {
  const request = (id: number, createdAt: string, address = "eva.brandl@labor-kanal.example", docType: DocumentType = "lab-result") => ({
    id,
    docType,
    address,
    createdAt: at(createdAt),
  });
  const rows = [
    request(1, "09:00:00"),
    request(2, "10:00:00"),
    // M1's mistyped address, request 2, and a lab result for someone else do not count.
    request(3, "11:00:00", "eva.brandl@labor-kanaI.example"),
    request(4, "11:30:00", "+43 660 000 0101", "rehab-report"),
    request(5, "11:45:00", "anna.huber@example.org"),
  ];
  assert.equal(latestRequest1(rows), 2);
  assert.equal(latestRequest1([...rows, request(6, "12:00:00", " Eva.Brandl@labor-kanal.example ")]), 6);
  assert.equal(latestRequest1(rows.slice(2)), undefined);
});

test("the effort timeline marks start and stop and gives the seconds the stopwatch is compared with", () => {
  const lines = effortLines(request1, 1);
  assert.match(lines[0], /^Request 1: seconds since the link_opened that starts the clock/);
  // The colleague's opening at 13:05 lies 55 minutes before the start.
  assert.match(lines.find((l) => l.includes("13:05:00"))!, /-3300\.0 s {2}link_opened/);
  assert.match(lines.find((l) => l.includes("<- start"))!, /14:00:00\.000Z +0\.0 s {2}link_opened {9}shown/);
  assert.match(lines.find((l) => l.includes("<- stop"))!, /14:02:10\.000Z +130\.0 s {2}answer_sent/);
  assert.equal(lines.filter((l) => l.includes("<-")).length, 2);
  assert.equal(lines.at(-1), "Effort: 130 s (130.0 s) from link_opened to the answer_sent that was filed.");
});

test("the effort timeline before filing counts from the first entry and measures nothing", () => {
  const lines = effortLines(request1.slice(0, 9), 1);
  assert.match(lines[0], /since the first entry/);
  assert.match(lines.find((l) => l.includes("14:02:10"))!, /3730\.0 s {2}answer_sent/);
  assert.ok(lines.every((l) => !l.includes("<-")));
  assert.equal(lines.at(-1), "Effort: not measured, because no answer was filed.");
  assert.deepEqual(effortLines(request1, 2), ["Request 2: no audit entries"]);
});
