// Runs the HL7 validator (validator_cli.jar) and counts its issues (docs/FHIR.md, "Validation").
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { FhirError, fhirFetch } from "@/server/fhir/client";

export const FILED_DIR = path.join("out", "filed");
export const VALIDATOR_JAR = path.join("tools", "validator_cli.jar");
// Pinned, because `java -jar` runs whatever the file contains. To update, change all three values and docs/DEVELOPMENT.md.
export const VALIDATOR_VERSION = "7.0.3";
export const VALIDATOR_URL = `https://github.com/hapifhir/org.hl7.fhir.core/releases/download/${VALIDATOR_VERSION}/validator_cli.jar`;
// The SHA-256 that GitHub lists for this release asset.
export const VALIDATOR_SHA256 = "57aa43fb40cec5de41def81c927725fd85908eeb71509b7f9313e04d9b8ec79b";

export type Issue = { severity: string; location: string; message: string };
export type FileResult = { file: string; errors: number; warnings: number; issues: Issue[] };

type OperationOutcome = {
  resourceType: "OperationOutcome";
  extension?: { url: string; valueString?: string }[];
  issue?: { severity?: string; expression?: string[]; location?: string[]; details?: { text?: string }; diagnostics?: string }[];
};

const FILE_EXTENSION = "http://hl7.org/fhir/StructureDefinition/operationoutcome-file";

// The validator writes one OperationOutcome for one file and a Bundle of them for several.
// Errors are issues with severity `error` or `fatal`. Warnings do not count toward the metric.
export function summarizeOutput(output: unknown): FileResult[] {
  const o = output as { resourceType?: string; entry?: { resource?: unknown }[] };
  const outcomes = (o.resourceType === "Bundle" ? (o.entry ?? []).map((e) => e.resource) : [o]) as OperationOutcome[];
  return outcomes
    .filter((oo) => oo?.resourceType === "OperationOutcome")
    .map((oo) => {
      const issues = (oo.issue ?? []).map((i) => ({
        severity: i.severity ?? "unknown",
        location: (i.expression ?? i.location ?? []).join(", "),
        message: i.details?.text ?? i.diagnostics ?? "",
      }));
      return {
        file: oo.extension?.find((e) => e.url === FILE_EXTENSION)?.valueString ?? "",
        errors: issues.filter((i) => i.severity === "error" || i.severity === "fatal").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        issues,
      };
    });
}

export const totalErrors = (results: FileResult[]) => results.reduce((n, r) => n + r.errors, 0);

async function fileSha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

// Returns the jar after checking its SHA-256. Downloads the pinned version when the file is missing.
// A file with another hash is never run: it may be another version or a broken download.
export async function ensureValidatorJar(
  jar = VALIDATOR_JAR,
  expected = VALIDATOR_SHA256,
  log: (line: string) => void = console.log,
): Promise<string> {
  if (existsSync(jar)) {
    const actual = await fileSha256(jar);
    if (actual !== expected) {
      throw new Error(
        `${jar} has SHA-256 ${actual}, not the pinned HL7 validator ${VALIDATOR_VERSION} (${expected}). ` +
          "Delete it, and pnpm validate downloads the pinned version.",
      );
    }
    return jar;
  }
  log(`Downloading the HL7 validator ${VALIDATOR_VERSION} to ${jar} ...`);
  const res = await fetch(VALIDATOR_URL);
  if (!res.ok) throw new Error(`Could not download the HL7 validator (${res.status}). See docs/DEVELOPMENT.md, "HL7 validator".`);
  const body = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== expected) throw new Error(`The downloaded HL7 validator has SHA-256 ${actual}, not ${expected}. Nothing was saved.`);
  await mkdir(path.dirname(jar), { recursive: true });
  const partial = `${jar}.part`;
  await writeFile(partial, body);
  await rename(partial, jar);
  return jar;
}

// Validates the files in one validator run against base FHIR R4 and writes the raw result to `outputFile`.
// The first run downloads the FHIR packages to ~/.fhir and takes a few minutes. The validator needs internet for tx.fhir.org.
export async function runValidator(files: string[], outputFile: string): Promise<FileResult[]> {
  if (!files.length) return [];
  const jar = await ensureValidatorJar();
  await mkdir(path.dirname(outputFile), { recursive: true });
  await rm(outputFile, { force: true });
  const args = ["-jar", jar, ...files, "-version", "4.0", "-locale", "en-US", "-output", outputFile];
  const log: string[] = [];
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn("java", args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (b: Buffer) => log.push(b.toString()));
    child.stderr.on("data", (b: Buffer) => log.push(b.toString()));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(
        err.code === "ENOENT" ? new Error("Java is not on the PATH. The HL7 validator needs Java 17 or newer (docs/DEVELOPMENT.md).") : err,
      ),
    );
    child.on("close", (c) => resolve(c ?? 1));
  });
  let output: unknown;
  try {
    output = JSON.parse(await readFile(outputFile, "utf8"));
  } catch {
    throw new Error(`The validator exited with ${code} and wrote no result. Its last lines:\n${log.join("").split("\n").slice(-20).join("\n")}`);
  }
  return summarizeOutput(output);
}

// Fetches each resource (`Type/id`) from the FHIR server into one JSON file per resource.
// A resource the server does not have fails the export: the audit log and the server do not belong to the same run.
export async function exportResources(refs: string[], dir = FILED_DIR, fetchResource = fhirFetch<unknown>): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    let resource: unknown;
    try {
      resource = await fetchResource(ref);
    } catch (e) {
      if (e instanceof FhirError && (e.status === 404 || e.status === 410)) {
        missing.push(ref);
        continue;
      }
      throw e;
    }
    const file = path.join(dir, `${ref.replace("/", "-")}.json`);
    await writeFile(file, JSON.stringify(resource, null, 2));
    files.push(file);
  }
  if (missing.length) {
    throw new Error(
      `${missing.length} of ${refs.length} filed resources are not on the FHIR server (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", ..." : ""}). ` +
        "The audit log is older than the FHIR data: run pnpm reset before a run, or pass --since.",
    );
  }
  return files;
}
