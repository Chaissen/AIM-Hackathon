import { z } from "zod";

import type { DocumentType } from "@/lib/document-types";
import type { requests } from "@/server/db/schema";
import type { RequestState } from "@/server/requests/lifecycle";

import { type AuditRow, effortSeconds, filedReferences, isMisdelivery, latestRequest1, REQUEST_1, requestCoverage, TRACK_EVENTS } from "./audit";
import { coverageMetric, effortMetric, type Metric, misdeliveryMetric, type StepStatus } from "./report";
import type { LastRuns, LastValidation } from "./runs";

export type TargetStatus = "met" | "missed" | "not_measured";
export type MisdeliveryTest = { id: "M1" | "M2" | "M3"; status: "caught" | "missed" | "not_run"; requestId: number | null };

export type MetricsOverview = {
  at: Date;
  validation: {
    status: TargetStatus;
    lastRun: Omit<LastValidation, "passed" | "references"> | null;
    /** Filed resources outside the last validation's scope. */
    filedSince: number;
  };
  effort: { status: TargetStatus; seconds: number | null; requestId: number | null };
  misdeliveries: { status: TargetStatus; caught: number; tests: MisdeliveryTest[] };
  coverage: { status: TargetStatus; covered: number; total: number; requestId: number | null; events: { event: (typeof TRACK_EVENTS)[number]; covered: boolean }[] };
  /** The caller's own requests */
  requests: { id: number; docType: DocumentType; person: string; state: RequestState; effortSeconds: number | null; covered: number }[];
  lastScenario: { at: Date; metrics: Metric[] } | null;
};

type RequestRow = typeof requests.$inferSelect;
export type AnyRequest = Pick<RequestRow, "id" | "docType" | "address" | "createdAt">;
export type OwnRequest = Pick<RequestRow, "id" | "docType" | "given" | "family" | "state">;

const targetStatus = (metric: Metric): TargetStatus => (metric.status === "blocked" ? "not_measured" : metric.status);

const upload = z.object({ sha256: z.string().min(1) });
const sha256Of = (row: AuditRow) => upload.safeParse(row.detail).data?.sha256;

function m1Caught(own: AuditRow[]): boolean {
  const mismatch = own.filter((r) => isMisdelivery(r, "address_mismatch")).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  return (
    mismatch !== undefined &&
    own.some((r) => isMisdelivery(r, "wrong_person") && r.at >= mismatch.at) &&
    !own.some((r) => r.event === "answer_sent")
  );
}

function m3Status(own: AuditRow[]): MisdeliveryTest["status"] {
  const stopped = own.filter((r) => isMisdelivery(r, "patient_mismatch"));
  if (stopped.length === 0) return "not_run";
  const stoppedHashes = stopped.map(sha256Of);
  const filedHashes = new Set(own.filter((r) => r.event === "answer_filed").map(sha256Of));
  if (stoppedHashes.some((hash) => hash !== undefined && filedHashes.has(hash))) return "missed";
  if (stoppedHashes.includes(undefined) || filedHashes.has(undefined)) return "not_run";
  return "caught";
}

/**
 * M1 to M3 from the audit log. M2 and M3 run on the newest request 1, M1 on the newest lab request to another address
 * than request 1's on which it was caught. A test without its entries has not run. Only M3 can be missed, by filing the
 * upload it stopped: a wrong person who passed in M1 or M2 would leave no entry that tells them apart.
 */
export function liveMisdeliveryTests(rows: AuditRow[], requests: AnyRequest[]): MisdeliveryTest[] {
  const own = (id: number) => rows.filter((r) => r.requestId === id);
  const m1 = requests
    .filter((r) => r.docType === REQUEST_1.docType && r.address.trim().toLowerCase() !== REQUEST_1.address)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
    .find((r) => m1Caught(own(r.id)));
  const request1 = latestRequest1(requests);
  const m2 = request1 !== undefined && own(request1).some((r) => isMisdelivery(r, "wrong_person")) ? "caught" : "not_run";
  const m3 = request1 === undefined ? "not_run" : m3Status(own(request1));
  return [
    m1 ? { id: "M1", status: "caught", requestId: m1.id } : { id: "M1", status: "not_run", requestId: null },
    { id: "M2", status: m2, requestId: m2 === "not_run" ? null : (request1 ?? null) },
    { id: "M3", status: m3, requestId: m3 === "not_run" ? null : (request1 ?? null) },
  ];
}

const STEP_STATUS: Record<MisdeliveryTest["status"], StepStatus> = { caught: "pass", missed: "fail", not_run: "skipped" };

const newer = (a: LastValidation | null, b: LastValidation | null) => (a && b ? (b.at > a.at ? b : a) : (a ?? b));

/**
 * The four targets read every request, as `clinic.audit` reads the whole log. `own` is the caller's requests, newest
 * first, for the table.
 */
export function metricsOverview(input: { at: Date; audit: AuditRow[]; requests: AnyRequest[]; own: OwnRequest[]; runs: LastRuns }): MetricsOverview {
  const { audit, runs } = input;
  const request1 = latestRequest1(input.requests);

  const run = newer(runs.validate, runs.scenario?.validation ?? null);
  const validatedReferences = new Set(run?.references ?? []);
  const seconds = request1 === undefined ? null : effortSeconds(audit, request1);
  const tests = liveMisdeliveryTests(audit, input.requests);
  const steps = tests.map(({ id, status }) => ({ id: id.toLowerCase(), title: id, status: STEP_STATUS[status], detail: "" }));
  const coverage = request1 === undefined ? undefined : requestCoverage(request1, audit);

  return {
    at: input.at,
    validation: {
      status: run === null ? "not_measured" : run.passed ? "met" : "missed",
      lastRun: run && { at: run.at, errors: run.errors, resources: run.resources, source: run.source },
      filedSince: filedReferences(audit).filter((reference) => !validatedReferences.has(reference)).length,
    },
    effort: { status: targetStatus(effortMetric(seconds)), seconds, requestId: request1 ?? null },
    misdeliveries: { status: targetStatus(misdeliveryMetric(steps)), caught: tests.filter((t) => t.status === "caught").length, tests },
    coverage: {
      status: targetStatus(coverageMetric(coverage)),
      covered: coverage?.covered ?? 0,
      total: TRACK_EVENTS.length,
      requestId: request1 ?? null,
      events: TRACK_EVENTS.map((event) => ({ event, covered: coverage?.events.some((e) => e.event === event && e.complete > 0) ?? false })),
    },
    requests: input.own.map((r) => ({
      id: r.id,
      docType: r.docType,
      person: `${r.given.trim()} ${r.family.trim()}`,
      state: r.state,
      effortSeconds: effortSeconds(audit, r.id),
      covered: requestCoverage(r.id, audit).covered,
    })),
    lastScenario: runs.scenario && { at: runs.scenario.at, metrics: runs.scenario.metrics },
  };
}
