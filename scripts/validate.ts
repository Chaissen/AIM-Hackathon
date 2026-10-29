// pnpm validate: runs the HL7 validator on every resource filed during a run and counts the errors (docs/FHIR.md, "Validation").
// pnpm validate <file or folder> ...: validates the given JSON files instead, without Postgres or HAPI.
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { filedReferences } from "@/server/metrics/audit";
import { METRICS_DIR } from "@/server/metrics/report";
import { exportResources, runValidator, totalErrors } from "@/server/metrics/validator";

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
    const rows = await db.select().from(auditLog).where(eq(auditLog.event, "answer_filed"));
    const refs = filedReferences(rows);
    console.log(`${rows.length} answer_filed entries name ${refs.length} resources. Exporting them from FHIR to out/filed/.`);
    return await exportResources(refs);
  } finally {
    await db.$client.end();
  }
}

const args = process.argv.slice(2);
const files = args.length ? await jsonFiles(args) : await exportFiled();
if (!files.length) {
  console.error("Nothing to validate. File an answer first, or pass JSON files: pnpm validate path/to/resource.json");
  process.exit(1);
}

console.log(`Validating ${files.length} resources against FHIR R4. The first run downloads the FHIR packages and takes a few minutes.`);
const results = await runValidator(files, path.join(METRICS_DIR, "validator-output.json"));
for (const r of results) {
  console.log(`${r.errors ? "FAIL" : "ok  "}  ${r.file}: ${r.errors} errors, ${r.warnings} warnings`);
  for (const i of r.issues.filter((i) => i.severity === "error" || i.severity === "fatal")) console.log(`      ${i.location}: ${i.message}`);
}
const errors = totalErrors(results);
await writeFile(path.join(METRICS_DIR, "validate.json"), JSON.stringify({ at: new Date(), errors, results }, null, 2));
console.log(`\nFHIR validation: ${errors} errors in ${results.length} resources (target 0).`);
process.exit(errors === 0 && results.length === files.length ? 0 : 1);
