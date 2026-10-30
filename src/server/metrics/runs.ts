import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { METRICS_DIR, type Metric, totalErrors, validationPassed } from "./report";

export type LastValidation = { at: Date; errors: number; resources: number; references: string[]; passed: boolean; source: "pnpm validate" | "pnpm scenario" };
export type LastRuns = {
  validate: LastValidation | null;
  scenario: { at: Date; metrics: Metric[]; validation: LastValidation | null } | null;
};

const at = z.iso.datetime().transform((value) => new Date(value));
const count = z.number().int().nonnegative();

const validationFile = z.object({
  at,
  files: count.positive(),
  references: z.array(z.string()),
  results: z.array(z.object({
    file: z.string(),
    errors: count,
    warnings: count,
    issues: z.array(z.object({ severity: z.string(), location: z.string(), message: z.string() })),
  })),
});

const scenarioFile = z.object({
  at,
  metrics: z.array(z.object({ name: z.string(), target: z.string(), result: z.string(), status: z.enum(["met", "missed", "blocked"]) })),
  validation: z.unknown().optional(),
});

function validationResult(value: z.infer<typeof validationFile>, source: LastValidation["source"]): LastValidation {
  return {
    at: value.at,
    errors: totalErrors(value.results),
    resources: value.results.length,
    references: value.results.length === value.files ? value.references : [],
    passed: validationPassed(value.files, value.results),
    source,
  };
}

async function readRun<T>(file: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}

export async function readLastRuns(dir = METRICS_DIR): Promise<LastRuns> {
  const [validate, scenario] = await Promise.all([
    readRun(path.join(dir, "validate.json"), validationFile),
    readRun(path.join(dir, "scenario.json"), scenarioFile),
  ]);
  const scenarioValidation = validationFile.safeParse(scenario?.validation);
  return {
    validate: validate && validationResult(validate, "pnpm validate"),
    scenario: scenario && {
      at: scenario.at,
      metrics: scenario.metrics,
      validation: scenarioValidation.success ? validationResult(scenarioValidation.data, "pnpm scenario") : null,
    },
  };
}
