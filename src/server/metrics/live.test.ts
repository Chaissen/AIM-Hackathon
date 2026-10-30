import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuditRow } from "./audit";
import { type AnyRequest, liveMisdeliveryTests, metricsOverview, type OwnRequest } from "./live";
import { effortMetric } from "./report";
import type { LastRuns } from "./runs";

let nextId = 1;
const start = new Date("2026-10-28T09:00:00Z").getTime();
const second = (s: number) => new Date(start + s * 1000);
const row = (requestId: number, s: number, r: Pick<AuditRow, "event" | "outcome"> & Partial<AuditRow>): AuditRow => ({
  id: nextId++,
  at: second(s),
  requestId,
  actorKind: "service",
  actor: "ordy",
  detail: {},
  ...r,
});

const checks = { checks: [{ check: "name", result: "fail", reason: "no_shared_family_name" }] };
const hofer = { actorKind: "network_member" as const, actor: "@lena.hofer:klinikum.example" };
const thomas = { actorKind: "outside_person" as const, actor: "Thomas Wagner (GH:thomas)" };
const anna = { actorKind: "outside_person" as const, actor: "Anna Huber (GH:anna)" };
const eva = { actorKind: "outside_person" as const, actor: "Eva Brandl (GH:eva)" };
const MAX = { sha256: "max", size: 600 };
const MARIA = { sha256: "maria", size: 564 };

// Request 1 with M2 and M3, filed 74 s after the last opening, and M1 on its own request.
const request1 = [
  row(1, 0, { ...hofer, event: "request_sent", outcome: "sent", detail: { docType: "lab-result", channel: "email", address: "eva.brandl@labor-kanal.example" } }),
  row(1, 60, { ...thomas, event: "link_opened", outcome: "shown", detail: { state: "sent" } }),
  row(1, 90, { ...thomas, event: "identity_checked", outcome: "fail", detail: checks }),
  row(1, 90, { ...thomas, event: "misdelivery_caught", outcome: "wrong_person", detail: checks }),
  row(1, 300, { ...eva, event: "link_opened", outcome: "shown", detail: { state: "sent" } }),
  row(1, 330, { ...eva, event: "identity_checked", outcome: "pass", detail: { checks: [{ check: "name", result: "pass", reason: "match" }] } }),
  row(1, 350, { ...eva, event: "answer_sent", outcome: "received", detail: MAX }),
  row(1, 350, { ...eva, event: "misdelivery_caught", outcome: "patient_mismatch", detail: { ...MAX, nameMatches: false, birthDateMatches: false } }),
  row(1, 374, { ...eva, event: "answer_sent", outcome: "received", detail: MARIA }),
  row(1, 375, { event: "answer_filed", outcome: "filed", detail: { resources: ["DiagnosticReport/7", "Observation/8"], provenance: "Provenance/9", ...MARIA } }),
];
const m1 = [
  row(3, 1000, { ...hofer, event: "misdelivery_caught", outcome: "address_mismatch", detail: { domain: "labor-kanaI.example", expectedDomain: "labor-kanal.example" } }),
  row(3, 1010, { ...hofer, event: "request_sent", outcome: "sent", detail: { docType: "lab-result", channel: "email", address: "eva.brandl@labor-kanaI.example", sentAnyway: true } }),
  row(3, 1100, { ...anna, event: "link_opened", outcome: "shown", detail: { state: "sent" } }),
  row(3, 1120, { ...anna, event: "identity_checked", outcome: "fail", detail: checks }),
  row(3, 1120, { ...anna, event: "misdelivery_caught", outcome: "wrong_person", detail: checks }),
];
const story = [...request1, ...m1];

const requests: AnyRequest[] = [
  { id: 1, docType: "lab-result", address: "eva.brandl@labor-kanal.example", createdAt: second(0) },
  { id: 3, docType: "lab-result", address: "eva.brandl@labor-kanaI.example", createdAt: second(1000) },
];
const own: OwnRequest[] = [
  { id: 3, docType: "lab-result", given: "Eva", family: "Brandl", state: "sent" },
  { id: 1, docType: "lab-result", given: " Eva", family: "Brandl ", state: "filed" },
];
const noRuns: LastRuns = { validate: null, scenario: null };
const at = new Date("2026-10-30T12:00:00Z");

const ALL_EVENTS = ["request_sent", "link_opened", "identity_checked", "answer_sent", "answer_filed", "misdelivery_caught"];

test("the scenario story meets effort, misdeliveries, and coverage", () => {
  const overview = metricsOverview({ at, audit: story, requests, own, runs: noRuns });
  assert.deepEqual(overview.effort, { status: "met", seconds: 74, requestId: 1 });
  assert.deepEqual(overview.misdeliveries, {
    status: "met",
    caught: 3,
    tests: [
      { id: "M1", status: "caught", requestId: 3 },
      { id: "M2", status: "caught", requestId: 1 },
      { id: "M3", status: "caught", requestId: 1 },
    ],
  });
  assert.deepEqual(overview.coverage, { status: "met", covered: 6, total: 6, requestId: 1, events: ALL_EVENTS.map((event) => ({ event, covered: true })) });
  assert.deepEqual(overview.requests, [
    { id: 3, docType: "lab-result", person: "Eva Brandl", state: "sent", effortSeconds: null, covered: 4 },
    { id: 1, docType: "lab-result", person: "Eva Brandl", state: "filed", effortSeconds: 74, covered: 6 },
  ]);
});

test("without the M3 entry, 2 of 3 misdeliveries is missed", () => {
  const audit = story.filter((r) => r.outcome !== "patient_mismatch");
  assert.deepEqual(metricsOverview({ at, audit, requests, own, runs: noRuns }).misdeliveries, {
    status: "missed",
    caught: 2,
    tests: [
      { id: "M1", status: "caught", requestId: 3 },
      { id: "M2", status: "caught", requestId: 1 },
      { id: "M3", status: "not_run", requestId: null },
    ],
  });
});

test("M3 is missed when the upload it stopped was filed after all", () => {
  const audit = story.map((r) => (r.event === "answer_filed" ? { ...r, detail: { ...r.detail, sha256: MAX.sha256 } } : r));
  assert.deepEqual(liveMisdeliveryTests(audit, requests)[2], { id: "M3", status: "missed", requestId: 1 });
});

test("M1 is not caught while nobody was turned away, or when someone answered", () => {
  const unopened = story.filter((r) => r.requestId !== 3 || r.at < second(1100));
  assert.deepEqual(liveMisdeliveryTests(unopened, requests)[0], { id: "M1", status: "not_run", requestId: null });
  const answered = [...story, row(3, 1200, { ...eva, event: "answer_sent", outcome: "received", detail: MARIA })];
  assert.deepEqual(liveMisdeliveryTests(answered, requests)[0], { id: "M1", status: "not_run", requestId: null });
});

test("with no requests and no runs, nothing is measured", () => {
  assert.deepEqual(metricsOverview({ at, audit: [], requests: [], own: [], runs: noRuns }), {
    at,
    validation: { status: "not_measured", lastRun: null, filedSince: 0 },
    effort: { status: "not_measured", seconds: null, requestId: null },
    misdeliveries: {
      status: "not_measured",
      caught: 0,
      tests: [
        { id: "M1", status: "not_run", requestId: null },
        { id: "M2", status: "not_run", requestId: null },
        { id: "M3", status: "not_run", requestId: null },
      ],
    },
    coverage: { status: "not_measured", covered: 0, total: 6, requestId: null, events: ALL_EVENTS.map((event) => ({ event, covered: false })) },
    requests: [],
    lastScenario: null,
  });
});

test("validation takes the newer run and counts the resources outside its scope", () => {
  const validate = { at: second(370), errors: 0, resources: 2, references: [], passed: true, source: "pnpm validate" as const };
  const scenario = { at: second(100), metrics: [effortMetric(74)], validation: { ...validate, at: second(100), errors: 3, passed: false, source: "pnpm scenario" as const } };
  assert.deepEqual(metricsOverview({ at, audit: story, requests, own, runs: { validate, scenario } }).validation, {
    status: "met",
    lastRun: { at: second(370), errors: 0, resources: 2, source: "pnpm validate" },
    filedSince: 3,
  });
  const later = { ...scenario, at: second(400), validation: { ...scenario.validation, at: second(400), references: ["DiagnosticReport/7", "Observation/8", "Provenance/9"] } };
  const overview = metricsOverview({ at, audit: story, requests, own, runs: { validate, scenario: later } });
  assert.deepEqual(overview.validation, { status: "missed", lastRun: { at: second(400), errors: 3, resources: 2, source: "pnpm scenario" }, filedSince: 0 });
  assert.deepEqual(overview.lastScenario, { at: second(400), metrics: [effortMetric(74)] });
  assert.deepEqual(metricsOverview({ at, audit: story, requests, own, runs: noRuns }).validation.filedSince, 3);
});
