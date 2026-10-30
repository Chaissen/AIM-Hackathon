// pnpm validate [--since <time>]: runs the HL7 validator on the resources named in the answer_filed entries and counts
// the errors (docs/FHIR.md, "Validation"). Without --since it takes every entry in the log; `pnpm reset` empties the log.
// pnpm validate <file or folder> ...: validates the given JSON files instead, without Postgres or HAPI.
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { and, eq, gte } from "drizzle-orm";

import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { filedReferences } from "@/server/metrics/audit";
import { METRICS_DIR, validationPassed } from "@/server/metrics/report";
import { exportResources, runValidator, totalErrors, type FileResult } from "@/server/metrics/validator";

const { values, positionals } = parseArgs({ options: { since: { type: "string" } }, allowPositionals: true });
const since = values.since === undefined ? undefined : new Date(values.since);
if (since && Number.isNaN(since.getTime())) {
  console.error("Usage: pnpm validate [--since 2026-10-30T09:00:00Z] [file or folder ...]");
  process.exit(2);
}

async function jsonFiles(args: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const arg of args) {
    if ((await stat(arg)).isDirectory()) {
      const names = (await readdir(arg)).filter((n) => n.endsWith(".json")).sort();
      files.push(...names.map((n) => path.join(arg, n)));
    } else files.push(arg);
  }
  return files;
}

async function exportFiled(): Promise<string[]> {
  try {
    const filed = eq(auditLog.event, "answer_filed");
    const rows = await db.select().from(auditLog).where(since ? and(filed, gte(auditLog.at, since)) : filed);
    const refs = filedReferences(rows);
    const scope = since ? `since ${since.toISOString()}` : "in the whole audit log";
    console.log(`${rows.length} answer_filed entries ${scope} name ${refs.length} resources. Exporting them from FHIR to out/filed/.`);
    return await exportResources(refs);
  } finally {
    await db.$client.end();
  }
}

let files: string[];
try {
  files = positionals.length ? await jsonFiles(positionals) : await exportFiled();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
if (!files.length) {
  console.error("Nothing to validate. File an answer first, or pass JSON files: pnpm validate path/to/resource.json");
  process.exit(1);
}

console.log(`Validating ${files.length} resources against FHIR R4. The first run downloads the FHIR packages and takes a few minutes.`);
let results: FileResult[];
try {
  results = await runValidator(files, path.join(METRICS_DIR, "validator-output.json"));
} catch (e) {
  // No Java, a jar with the wrong hash, a failed download, or no result file.
  console.error(`The validator did not run. ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
for (const r of results) {
  console.log(`${r.errors ? "FAIL" : "ok  "}  ${r.file}: ${r.errors} errors, ${r.warnings} warnings`);
  for (const i of r.issues.filter((i) => i.severity === "error" || i.severity === "fatal")) console.log(`      ${i.location}: ${i.message}`);
}
const errors = totalErrors(results);
await writeFile(path.join(METRICS_DIR, "validate.json"), JSON.stringify({ at: new Date(), errors, results }, null, 2));
console.log(`\nFHIR validation: ${errors} errors in ${results.length} resources (target 0).`);
if (results.length !== files.length) console.log(`The validator reported on ${results.length} of ${files.length} files.`);
process.exit(validationPassed(files.length, results) ? 0 : 1);
