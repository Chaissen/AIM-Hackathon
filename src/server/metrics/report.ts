// The four metric results in one table, for the README (docs/WHITEPAPER.md, "How we measure the metrics").
// Pure functions, so `pnpm scenario` and the tests share the rules for "met".
import path from "node:path";

import { AUDIT_EVENTS, type RequestCoverage } from "./audit";
import { totalErrors, type FileResult } from "./validator";

export type MetricStatus = "met" | "missed" | "blocked";
export type Metric = { name: string; target: string; result: string; status: MetricStatus };
export type StepStatus = "pass" | "fail" | "blocked" | "skipped";
export type StepResult = { id: string; title: string; status: StepStatus; detail: string };

export const METRICS_DIR = path.join("out", "metrics");

const STATUS_LABEL: Record<MetricStatus, string> = { met: "met", missed: "missed", blocked: "not measured" };

export function metricsMarkdown(metrics: Metric[], at: Date): string {
  const rows = metrics.map((m) => `| ${m.name} | ${m.target} | ${m.result} | ${STATUS_LABEL[m.status]} |`);
  return [
    `Metric results from \`pnpm scenario\` on ${at.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    "",
    "| Metric | Target | Result | Status |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

// The validator must have reported on every exported file. A missing result is not a pass.
export const validationPassed = (files: number, results: FileResult[]) => results.length === files && totalErrors(results) === 0;

export type ValidationRun =
  | { kind: "nothing_filed" }
  | { kind: "skipped"; resources: number }
  | { kind: "failed"; error: string }
  | { kind: "done"; files: number; results: FileResult[] };

export function validationMetric(run: ValidationRun): Metric {
  const base = { name: "FHIR validation", target: "0 errors" };
  switch (run.kind) {
    case "nothing_filed":
      return { ...base, result: "no filed resources", status: "blocked" };
    case "skipped":
      return { ...base, result: `${run.resources} filed resources, validator skipped (--no-validate)`, status: "blocked" };
    case "failed":
      return { ...base, result: `validator did not run: ${run.error}`, status: "blocked" };
    case "done": {
      const errors = totalErrors(run.results);
      const missing = run.files - run.results.length;
      const result = `${errors} errors in ${run.results.length} resources${missing ? `, no result for ${missing} of ${run.files}` : ""}`;
      return { ...base, result, status: validationPassed(run.files, run.results) ? "met" : "missed" };
    }
  }
}

export function effortMetric(seconds: number | null): Metric {
  const base = { name: "Effort for the outside person", target: "0 installs, 0 accounts, under 2 minutes" };
  if (seconds === null) return { ...base, result: "request 1 not filed", status: "blocked" };
  return {
    ...base,
    result: `${Math.round(seconds)} s from link_opened to the answer_sent that was filed (automated run; the stopwatch test is #20)`,
    status: seconds < 120 ? "met" : "missed",
  };
}

export const MISDELIVERY_STEPS = ["m1", "m2", "m3"] as const;

// A misdelivery test counts only when its step passed, that is, when every check of its "Caught if" held.
export function misdeliveryMetric(steps: StepResult[]): Metric {
  const base = { name: "Misdeliveries caught", target: "3 of 3" };
  const status = (id: string) => steps.find((s) => s.id === id)?.status;
  const ran = MISDELIVERY_STEPS.filter((id) => status(id) === "pass" || status(id) === "fail");
  if (!ran.length) return { ...base, result: "M1 to M3 not run", status: "blocked" };
  const caught = MISDELIVERY_STEPS.filter((id) => status(id) === "pass").length;
  const notRun = MISDELIVERY_STEPS.length - ran.length;
  return {
    ...base,
    result: `${caught} of ${MISDELIVERY_STEPS.length}${notRun ? ` (${notRun} not run)` : ""}`,
    status: caught === MISDELIVERY_STEPS.length ? "met" : "missed",
  };
}

// Audit coverage counts request 1: it is the request on which every event type happens, M2 and M3 included.
export function coverageMetric(request1: RequestCoverage | undefined): Metric {
  const base = { name: "Audit coverage", target: `${AUDIT_EVENTS.length} of ${AUDIT_EVENTS.length} on request 1` };
  if (!request1) return { ...base, result: "request 1 not sent", status: "blocked" };
  return {
    ...base,
    result: `${request1.covered} of ${AUDIT_EVENTS.length} on request ${request1.requestId}`,
    status: request1.covered === AUDIT_EVENTS.length ? "met" : "missed",
  };
}
