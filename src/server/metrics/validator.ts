// Runs the HL7 validator (validator_cli.jar) and counts its issues (docs/FHIR.md, "Validation").
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { fhirFetch } from "@/server/fhir/client";

export const FILED_DIR = path.join("out", "filed");
export const VALIDATOR_JAR = path.join("tools", "validator_cli.jar");
export const VALIDATOR_URL = "https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar";

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

export async function ensureValidatorJar(log: (line: string) => void = console.log): Promise<string> {
  if (existsSync(VALIDATOR_JAR)) return VALIDATOR_JAR;
  log(`Downloading the HL7 validator to ${VALIDATOR_JAR} ...`);
  const res = await fetch(VALIDATOR_URL);
  if (!res.ok) throw new Error(`Could not download the HL7 validator (${res.status}). See docs/DEVELOPMENT.md, "HL7 validator".`);
  await mkdir(path.dirname(VALIDATOR_JAR), { recursive: true });
  const partial = `${VALIDATOR_JAR}.part`;
  await writeFile(partial, Buffer.from(await res.arrayBuffer()));
  await rename(partial, VALIDATOR_JAR);
  return VALIDATOR_JAR;
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
export async function exportResources(refs: string[], dir = FILED_DIR): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const ref of refs) {
    const file = path.join(dir, `${ref.replace("/", "-")}.json`);
    await writeFile(file, JSON.stringify(await fhirFetch(ref), null, 2));
    files.push(file);
  }
  return files;
}
