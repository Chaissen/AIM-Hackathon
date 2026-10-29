import assert from "node:assert/strict";
import { test } from "node:test";

import { metricsMarkdown } from "./report";
import { summarizeOutput, totalErrors } from "./validator";

const FILE = "http://hl7.org/fhir/StructureDefinition/operationoutcome-file";

// Shortened from a real validator_cli.jar run (version 7.0.3) on two hand-made Observations.
const good = {
  resourceType: "OperationOutcome",
  extension: [{ url: FILE, valueString: "out/filed/Observation-13.json" }],
  issue: [
    {
      severity: "warning",
      code: "invariant",
      details: { text: "Constraint failed: dom-6: 'A resource should have narrative for robust management'" },
      expression: ["Observation"],
    },
  ],
};
const bad = {
  resourceType: "OperationOutcome",
  extension: [{ url: FILE, valueString: "out/filed/Observation-14.json" }],
  issue: [
    { severity: "error", code: "invalid", details: { text: "If a date has a time, it must have a timezone" }, expression: ["Observation.effective.ofType(dateTime)"] },
    { severity: "error", code: "invariant", details: { text: "Rule qty-3 failed" }, expression: ["Observation.value.ofType(Quantity)"] },
    { severity: "fatal", code: "structure", diagnostics: "Unable to parse" },
    { severity: "information", code: "informational", details: { text: "Note" } },
  ],
};

test("a Bundle of OperationOutcomes gives one result per file", () => {
  const results = summarizeOutput({ resourceType: "Bundle", type: "collection", entry: [{ resource: good }, { resource: bad }] });
  assert.deepEqual(
    results.map((r) => [r.file, r.errors, r.warnings]),
    [
      ["out/filed/Observation-13.json", 0, 1],
      ["out/filed/Observation-14.json", 3, 0],
    ],
  );
  assert.equal(totalErrors(results), 3);
  assert.deepEqual(results[1].issues[0], {
    severity: "error",
    location: "Observation.effective.ofType(dateTime)",
    message: "If a date has a time, it must have a timezone",
  });
  assert.equal(results[1].issues[2].message, "Unable to parse");
});

test("a single OperationOutcome gives one result", () => {
  const results = summarizeOutput(good);
  assert.equal(results.length, 1);
  assert.equal(totalErrors(results), 0);
  assert.deepEqual(summarizeOutput({ resourceType: "Patient" }), []);
});

test("the metrics table names each metric with its target, result, and status", () => {
  const md = metricsMarkdown(
    [
      { name: "FHIR validation", target: "0 errors", result: "0 errors in 7 resources", status: "met" },
      { name: "Audit coverage", target: "6 of 6", result: "no request sent", status: "blocked" },
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
      "| Audit coverage | 6 of 6 | no request sent | not measured |",
      "",
    ].join("\n"),
  );
});
