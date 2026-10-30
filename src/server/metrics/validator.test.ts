import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { FhirError } from "@/server/fhir/client";

import { totalErrors } from "./report";
import { ensureValidatorJar, exportResources, summarizeOutput, VALIDATOR_URL } from "./validator";

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

test("the validator download is pinned to a release, not to latest", () => {
  assert.match(VALIDATOR_URL, /\/releases\/download\/\d+\.\d+\.\d+\/validator_cli\.jar$/);
});

test("a jar is used only when its SHA-256 matches the pin", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ordy-validator-"));
  try {
    const jar = path.join(dir, "validator_cli.jar");
    await writeFile(jar, "pinned bytes");
    const pinned = createHash("sha256").update("pinned bytes").digest("hex");
    const silent = () => {};
    assert.equal(await ensureValidatorJar(jar, pinned, silent), jar);
    await writeFile(jar, "other bytes");
    await assert.rejects(ensureValidatorJar(jar, pinned, silent), /not the pinned HL7 validator/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an export fails with the resources the FHIR server does not have", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ordy-export-"));
  try {
    const fetchResource = async (ref: string) => {
      if (ref === "Task/ordy-request-1") throw new FhirError(404, null);
      return { resourceType: ref.split("/")[0], id: ref.split("/")[1] };
    };
    assert.deepEqual(await exportResources(["Observation/1"], dir, fetchResource), [path.join(dir, "Observation-1.json")]);
    await assert.rejects(exportResources(["Observation/1", "Task/ordy-request-1"], dir, fetchResource), /1 of 2 filed resources are not on the FHIR server \(Task\/ordy-request-1\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
