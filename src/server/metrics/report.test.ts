import assert from "node:assert/strict";
import { test } from "node:test";

import type { RequestCoverage } from "./audit";
import { coverageMetric, effortMetric, metricsMarkdown, misdeliveryMetric, validationMetric, type StepResult, type StepStatus } from "./report";
import type { FileResult } from "./validator";

const step = (id: string, status: StepStatus): StepResult => ({ id, title: id, status, detail: "" });
const clean = (file: string): FileResult => ({ file, errors: 0, warnings: 1, issues: [] });

test("a misdelivery test whose later checks failed is not caught", () => {
  // M3 logged patient_mismatch, but the Matrix notice was missing, so its step failed.
  const metric = misdeliveryMetric([step("m1", "pass"), step("m2", "pass"), step("m3", "fail")]);
  assert.deepEqual([metric.result, metric.status], ["2 of 3", "missed"]);
  assert.equal(misdeliveryMetric([step("m1", "pass"), step("m2", "pass"), step("m3", "pass")]).status, "met");
});

test("misdelivery tests that did not run are named, and none run is not measured", () => {
  const some = misdeliveryMetric([step("m1", "blocked"), step("m2", "pass"), step("m3", "pass")]);
  assert.deepEqual([some.result, some.status], ["2 of 3 (1 not run)", "missed"]);
  assert.equal(misdeliveryMetric([step("m1", "blocked"), step("m2", "skipped")]).status, "blocked");
});

test("validation is met only with a result for every exported file and no errors", () => {
  const all = validationMetric({ kind: "done", files: 2, results: [clean("a.json"), clean("b.json")] });
  assert.deepEqual([all.result, all.status], ["0 errors in 2 resources", "met"]);
  const short = validationMetric({ kind: "done", files: 3, results: [clean("a.json"), clean("b.json")] });
  assert.deepEqual([short.result, short.status], ["0 errors in 2 resources, no result for 1 of 3", "missed"]);
  const errors = validationMetric({ kind: "done", files: 1, results: [{ ...clean("a.json"), errors: 2 }] });
  assert.equal(errors.status, "missed");
  assert.equal(validationMetric({ kind: "nothing_filed" }).status, "blocked");
  assert.equal(validationMetric({ kind: "skipped", resources: 4 }).status, "blocked");
  assert.match(validationMetric({ kind: "failed", error: "Java is not on the PATH." }).result, /validator did not run: Java/);
});

test("effort is met under two minutes and not measured before request 1 is filed", () => {
  assert.equal(effortMetric(85).status, "met");
  assert.equal(effortMetric(140).status, "missed");
  assert.equal(effortMetric(null).status, "blocked");
});

test("the effort status agrees with the shown number of seconds", () => {
  const justUnder = effortMetric(119.4);
  assert.deepEqual([justUnder.result.split(" s ")[0], justUnder.status], ["automated run: 119", "met"]);
  const roundsUp = effortMetric(119.6);
  assert.deepEqual([roundsUp.result.split(" s ")[0], roundsUp.status], ["automated run: 120", "missed"]);
});

test("the effort result says it is machine time, not a person, and names the timed test", () => {
  assert.match(effortMetric(74).result, /^automated run: 74 s .*not a person.*TIMED_TEST_20\.md/);
});

test("audit coverage counts request 1", () => {
  const coverage = (covered: number): RequestCoverage => ({ requestId: 1, events: [], covered });
  assert.deepEqual([coverageMetric(coverage(6)).result, coverageMetric(coverage(6)).status], ["6 of 6 on request 1", "met"]);
  assert.equal(coverageMetric(coverage(5)).status, "missed");
  assert.equal(coverageMetric(undefined).status, "blocked");
});

test("the metrics table names each metric with its target, result, and status", () => {
  const md = metricsMarkdown(
    [
      { name: "FHIR validation", target: "0 errors", result: "0 errors in 7 resources", status: "met" },
      { name: "Audit coverage", target: "6 of 6 on request 1", result: "request 1 not sent", status: "blocked" },
    ],
    new Date("2026-10-30T09:15:42Z"),
  );
  assert.equal(
    md,
    [
      "Metric results from `pnpm scenario` on 2026-10-30 09:15 UTC.",
      "",
      "| Metric | Target | Result | Status |",
      "|---|---|---|---|",
      "| FHIR validation | 0 errors | 0 errors in 7 resources | met |",
      "| Audit coverage | 6 of 6 on request 1 | request 1 not sent | not measured |",
      "",
    ].join("\n"),
  );
});
