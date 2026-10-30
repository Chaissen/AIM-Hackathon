import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { parseDocument } from "@/server/documents/parse";
import type { LabResult, RehabReport } from "@/server/documents/types";

import { createEhvdClient, type EhvdClient } from "./client";
import { checkRelease, type ReleaseInput } from "./release-check";
import { startEhvdMock } from "./start-mock";

let mock: Awaited<ReturnType<typeof startEhvdMock>>;
let client: EhvdClient;

before(async () => {
  mock = await startEhvdMock();
  client = createEhvdClient({ url: mock.url });
});
after(() => mock.close());

const scenario = (file: string) => readFileSync(new URL(`../../../track/scenario/documents/${file}`, import.meta.url), "utf8");
function parsed<T extends LabResult | RehabReport>(markdown: string): T {
  const result = parseDocument(markdown);
  assert.ok(result.ok, result.ok ? "" : result.errors.join(" "));
  return result.document as T;
}

const lab = (edit: (markdown: string) => string = (m) => m) => parsed<LabResult>(edit(scenario("lab-result-maria-beispiel.md")));
const rehab = (edit: (markdown: string) => string = (m) => m) => parsed<RehabReport>(edit(scenario("rehab-report-maria-beispiel.md")));

const EVA_OID = "1.2.40.0.34.3.2.99.1.2";
const eva = { givenName: "Eva", familyName: "Brandl", gdaOid: EVA_OID };
const stefan = { givenName: "Stefan", familyName: "Kern", gdaOid: null };

const run = (input: Partial<ReleaseInput> & Pick<ReleaseInput, "document">) => checkRelease({ org: "Labor Kanalstraße", sender: eva, ...input }, client);

test("Dr. Brandl's lab result passes through the OID in her login", async () => {
  const check = await run({ document: lab() });
  assert.equal(check.verdict, "pass");
  if (check.verdict !== "pass") return;
  assert.equal(check.via, "claim");
  assert.equal(check.practitioner.id.id, EVA_OID);
  assert.equal(check.organisation.id.id, "1.2.40.0.34.3.1.99.1.2");
});

test("without the claim, or from another sender, the name search confirms her", async () => {
  for (const sender of [{ ...eva, gdaOid: null }, { givenName: "Thomas", familyName: "Wagner", gdaOid: null }]) {
    const check = await run({ document: lab(), sender });
    assert.equal(check.verdict === "pass" && check.via, "search", sender.givenName);
  }
});

test("Dr. Leitner's rehab report sent by Stefan Kern passes", async () => {
  const check = await run({ document: rehab(), org: "Reha Waldblick", sender: stefan });
  assert.equal(check.verdict === "pass" && check.practitioner.id.id, "1.2.40.0.34.3.2.99.1.3");
});

test("a lab result validated by someone the eHVD does not confirm is held, with the reason", async () => {
  const validatedBy = (name: string) => lab((m) => m.replace("Validated by: Dr. Eva Brandl, lab physician", `Validated by: ${name}, lab physician`));
  const cases: [LabResult, ReleaseInput["sender"], string, string][] = [
    [validatedBy("Dr. Martin Brandl"), stefan, "not_member", "The eHVD does not list Dr. Martin Brandl as a member of Labor Kanalstraße."],
    [validatedBy("Dr. Johanna Leitner"), stefan, "not_member", "The eHVD does not list Dr. Johanna Leitner as a member of Labor Kanalstraße."],
    [validatedBy("Dr. Anna Huber"), stefan, "not_listed", "The eHVD does not list Dr. Anna Huber."],
    [validatedBy("Dr. Eva O'Brandl"), stefan, "not_searchable", "The eHVD cannot be searched for Dr. Eva O'Brandl."],
    [lab((m) => m.replace("Validated by: Dr. Eva Brandl, lab physician\n", "")), eva, "no_responsible_person", "The document names nobody under Validated by."],
  ];
  for (const [document, sender, reason, sentence] of cases) {
    assert.deepEqual(await run({ document, sender }), { verdict: "hold", reason, sentence });
  }
});

test("a physician of another specialty is held as the wrong role", async () => {
  const document = lab((m) => m.replace("# Labor Kanalstraße:", "# Klinikum Beispielstadt:").replace("Dr. Eva Brandl, lab physician", "Dr. Lena Hofer, internist"));
  assert.deepEqual(await run({ document, org: "Klinikum Beispielstadt", sender: stefan }), {
    verdict: "hold",
    reason: "wrong_role",
    sentence: "The eHVD does not list Dr. Lena Hofer as a specialist in medical and chemical laboratory diagnostics.",
  });
});

test("the organisation must be the one the request went to, and a rehab clinic must be a hospital", async () => {
  assert.equal((await run({ document: lab(), org: "Reha Waldblick" })).verdict, "hold");
  const fromLab = rehab((m) => m.replace("# Reha Waldblick:", "# Labor Kanalstraße:"));
  const check = await run({ document: fromLab, org: "Labor Kanalstraße", sender: stefan });
  assert.equal(check.verdict === "hold" && check.reason, "organisation_not_hospital");
  const elsewhere = await run({ document: lab(), org: "Labor Nirgendwo" });
  assert.equal(elsewhere.verdict === "hold" && elsewhere.reason, "organisation_differs");
});

test("the OID in the login must belong to the person the document names", async () => {
  const martin = await run({ document: lab(), sender: { ...eva, gdaOid: "1.2.40.0.34.3.2.99.1.4" } });
  assert.equal(martin.verdict === "hold" && martin.reason, "claim_differs");
  const unknown = await run({ document: lab(), sender: { ...eva, gdaOid: "1.2.40.0.34.3.2.99.9.1" } });
  assert.equal(unknown.verdict === "hold" && unknown.reason, "not_listed");
});

test("an eHVD that is down or answers 6003 is a hold, never a pass", async () => {
  const down = await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: eva }, createEhvdClient({ url: "http://127.0.0.1:9/" }));
  assert.deepEqual(down, { verdict: "hold", reason: "ehvd_unavailable", sentence: "The eHVD could not be reached to confirm Dr. Eva Brandl." });
  const fault = await run({ document: lab(), sender: { ...eva, gdaOid: "1.2.40.0.34.3.1.99.9.6003" } });
  assert.deepEqual(fault, { verdict: "hold", reason: "ehvd_unavailable", sentence: "The eHVD could not be reached to confirm Dr. Eva Brandl." });
});
