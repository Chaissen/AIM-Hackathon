import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { byResourceType, filedResource, readFiled } from "./filed";
import { parseDocument } from "./parse";
import { labResultMaria, rehabReportMaria } from "./scenario-fixtures";

// The Bundles of docs/clinical-review/19-fhir, as the filing posted them for requests 1 and 2.
function bundleResource(file: string, resourceType: string): unknown {
  const bundle = JSON.parse(readFileSync(new URL(`../../../docs/clinical-review/19-fhir/${file}`, import.meta.url), "utf8")) as {
    entry: { resource: { resourceType: string } }[];
  };
  return bundle.entry.find((e) => e.resource.resourceType === resourceType)?.resource;
}

test("a filed DiagnosticReport gives back the uploaded lab result", () => {
  const filed = readFiled(filedResource.parse(bundleResource("01-request-1-lab-result.bundle.json", "DiagnosticReport")));
  assert.deepEqual({ ...filed, markdown: filed.markdown?.split("\n")[0] }, {
    type: "lab-result",
    title: "Labor Kanalstraße: lab report",
    date: "2026-10-22T11:40:00+02:00",
    markdown: "# Labor Kanalstraße: lab report",
  });
  assert.equal(filed.markdown, labResultMaria.markdown);
  const parsed = parseDocument(filed.markdown ?? "");
  assert.equal(parsed.ok && parsed.document.type === "lab-result" && parsed.document.rows.length, 4);
});

test("a filed DocumentReference gives back the uploaded rehab report", () => {
  const filed = readFiled(filedResource.parse(bundleResource("02-request-2-rehab-report.bundle.json", "DocumentReference")));
  assert.deepEqual({ ...filed, markdown: filed.markdown?.split("\n")[0] }, {
    type: "rehab-report",
    title: "Reha Waldblick: discharge report",
    date: "2026-10-29T14:02:12+01:00",
    markdown: "# Reha Waldblick: discharge report",
  });
  assert.equal(filed.markdown, rehabReportMaria.markdown);
  const parsed = parseDocument(filed.markdown ?? "");
  assert.deepEqual(parsed.ok && parsed.document.type === "rehab-report" && parsed.document.stay, { start: "2026-09-02", end: "2026-09-23" });
});

test("only a text/markdown attachment counts as the document", () => {
  const markdown = Buffer.from("# Labor Kanalstraße: lab report").toString("base64");
  const pdf = { contentType: "application/pdf", data: markdown };
  const cases = [
    [{ resourceType: "DiagnosticReport", presentedForm: [pdf] }, null],
    [{ resourceType: "DiagnosticReport" }, null],
    [{ resourceType: "DiagnosticReport", presentedForm: [pdf, { contentType: "Text/Markdown; charset=utf-8", data: markdown }] }, "# Labor Kanalstraße: lab report"],
    [{ resourceType: "DocumentReference", content: [{ attachment: pdf }] }, null],
  ] as const;
  for (const [resource, expected] of cases) assert.equal(readFiled(filedResource.parse(resource)).markdown, expected, JSON.stringify(resource));
  assert.equal(filedResource.safeParse({ resourceType: "Observation" }).success, false);
});

test("filed resources list the document first and the parties last, each type in its given order", () => {
  const references = ["Task/ordy-request-1", "Practitioner/1068", "Observation/1073", "Organization/1069", "DiagnosticReport/1071", "Observation/1072", "Provenance/1076", "Binary/9", "Practitioner/1067"];
  assert.deepEqual(references.sort(byResourceType), [
    "DiagnosticReport/1071",
    "Observation/1073",
    "Observation/1072",
    "Provenance/1076",
    "Task/ordy-request-1",
    "Practitioner/1068",
    "Practitioner/1067",
    "Organization/1069",
    "Binary/9",
  ]);
});
