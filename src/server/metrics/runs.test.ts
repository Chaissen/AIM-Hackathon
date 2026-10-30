import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { coverageMetric, effortMetric, validationMetric } from "./report";
import { readLastRuns } from "./runs";

async function folder(t: { after: (fn: () => Promise<void>) => void }, files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "ordy-runs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
  return dir;
}

const result = (file: string, errors: number) => ({ file, errors, warnings: 0, issues: [] });

test("reads the last pnpm validate and pnpm scenario runs as the scripts write them", async (t) => {
  const validation = validationMetric({ kind: "done", files: 19, results: Array.from({ length: 19 }, (_, i) => result(`r${i}.json`, i === 0 ? 2 : 0)) });
  const metrics = [validation, effortMetric(74), coverageMetric(undefined)];
  const references = ["DiagnosticReport/1", "Observation/2"];
  const scenarioResults = Array.from({ length: 19 }, (_, i) => result(`r${i}.json`, i === 0 ? 2 : 0));
  const dir = await folder(t, {
    "validate.json": JSON.stringify({ at: new Date("2026-10-30T08:00:00Z"), files: 2, references, errors: 0, results: [result("a.json", 0), result("b.json", 0)] }, null, 2),
    "scenario.json": JSON.stringify({ at: new Date("2026-10-30T09:00:00Z"), requests: { r1: 1 }, steps: [], metrics,
      validation: { at: new Date("2026-10-30T09:05:00Z"), files: 19, references, results: scenarioResults } }, null, 2),
  });
  assert.deepEqual(await readLastRuns(dir), {
    validate: { at: new Date("2026-10-30T08:00:00Z"), errors: 0, resources: 2, references, passed: true, source: "pnpm validate" },
    scenario: {
      at: new Date("2026-10-30T09:00:00Z"),
      metrics,
      validation: { at: new Date("2026-10-30T09:05:00Z"), errors: 2, resources: 19, references, passed: false, source: "pnpm scenario" },
    },
  });
});

test("a scenario run whose validator did not run has no validation", async (t) => {
  const dir = await folder(t, {
    "scenario.json": JSON.stringify({ at: new Date("2026-10-30T09:00:00Z"), metrics: [validationMetric({ kind: "skipped", resources: 19 })] }),
  });
  assert.deepEqual((await readLastRuns(dir)).scenario?.validation, null);
});

test("a validator that missed a resource does not pass, even without errors", async (t) => {
  const run = validationMetric({ kind: "done", files: 3, results: [result("a.json", 0), result("b.json", 0)] });
  const validation = { at: new Date("2026-10-30T09:05:00Z"), files: 3, references: ["DiagnosticReport/1"], results: [result("a.json", 0), result("b.json", 0)] };
  const dir = await folder(t, { "scenario.json": JSON.stringify({ at: new Date("2026-10-30T09:00:00Z"), metrics: [run], validation }) });
  assert.deepEqual((await readLastRuns(dir)).scenario?.validation, {
    at: new Date("2026-10-30T09:05:00Z"),
    errors: 0,
    resources: 2,
    references: [],
    passed: false,
    source: "pnpm scenario",
  });
});

test("a missing or malformed file reads as no run", async (t) => {
  assert.deepEqual(await readLastRuns(await folder(t, {})), { validate: null, scenario: null });
  const malformed = await folder(t, {
    "validate.json": JSON.stringify({ at: "yesterday", errors: 0, results: [] }),
    "scenario.json": "{ not json",
  });
  assert.deepEqual(await readLastRuns(malformed), { validate: null, scenario: null });
});
