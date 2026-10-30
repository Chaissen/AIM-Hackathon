import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { parseDocument } from "@/server/documents/parse";
import type { LabResult, RehabReport } from "@/server/documents/types";

import { createEhvdClient, type EhvdClient } from "./client";
import { checkRelease, type ReleaseCheck, type ReleaseInput } from "./release-check";
import type { GdaDescriptor, GdaSearchQuery } from "./soap";
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
const LAB_OID = "1.2.40.0.34.3.1.99.1.2";
const eva = { givenName: "Eva", familyName: "Brandl", gdaOid: EVA_OID };
const stefan = { givenName: "Stefan", familyName: "Kern", gdaOid: null };

const run = (input: Partial<ReleaseInput> & Pick<ReleaseInput, "document">) => checkRelease({ org: "Labor Kanalstraße", sender: eva, ...input }, client);
/** A hold's reason and sentence, to compare. */
const held = (check: ReleaseCheck) => (check.verdict === "hold" ? { reason: check.reason, sentence: check.sentence } : check);

// Person searches are wildcards (`*Brandl*`), organisation searches are exact.
const isPersonSearch = (query: GdaSearchQuery) => query.surname.startsWith("*");
/** The mock, with its answers to person searches changed by `edit`. Organisation searches stay as they are. */
const editPeople = (edit: (gdas: GdaDescriptor[]) => GdaDescriptor[]): EhvdClient => ({
  getGda: (query) => client.getGda(query),
  gdaSearch: async (query) => {
    const result = await client.gdaSearch(query);
    return result.ok && isPersonSearch(query) ? { ok: true, value: edit(result.value) } : result;
  },
});
const TOO_MANY = { ok: false, failure: { kind: "fault", code: 6005, message: "Maximum numbers of compliances exceeded!" } } as const;

test("Dr. Brandl's lab result passes through the OID in her login", async () => {
  const check = await run({ document: lab() });
  assert.equal(check.verdict, "pass");
  if (check.verdict !== "pass") return;
  assert.equal(check.via, "claim");
  assert.equal(check.practitioner.id.id, EVA_OID);
  assert.equal(check.organisation.id.id, "1.2.40.0.34.3.1.99.1.2");
  assert.equal(check.senderIsResponsible, true);
});

test("without the claim, or from another sender, the name search confirms her", async () => {
  for (const [sender, senderIsResponsible] of [[{ ...eva, gdaOid: null }, true], [{ givenName: "Thomas", familyName: "Wagner", gdaOid: null }, false]] as const) {
    const check = await run({ document: lab(), sender });
    assert.deepEqual(check.verdict === "pass" && [check.via, check.senderIsResponsible], ["search", senderIsResponsible], sender.givenName);
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
    // A * in the document lands inside the wildcard and is refused.
    [validatedBy("Dr. Eva Br*"), stefan, "not_searchable", "The eHVD cannot be searched for Dr. Eva Br*."],
    [lab((m) => m.replace("Validated by: Dr. Eva Brandl, lab physician\n", "")), eva, "no_responsible_person", "The document names nobody under Validated by."],
  ];
  for (const [document, sender, reason, sentence] of cases) {
    assert.deepEqual(held(await run({ document, sender })), { reason, sentence });
  }
});

test("a hold keeps what the check found, for the filing if Dr. Hofer accepts", async () => {
  const document = lab((m) => m.replace("Dr. Eva Brandl, lab physician", "Dr. Martin Brandl, lab physician"));
  const check = await run({ document, sender: stefan });
  assert.deepEqual(check.verdict === "hold" && [check.reason, check.organisation?.id.id, check.practitioner?.id.id], ["not_member", "1.2.40.0.34.3.1.99.1.2", "1.2.40.0.34.3.2.99.1.4"]);
});

test("a name without a given name never passes, not even from the sender with the claim", async () => {
  const document = lab((m) => m.replace("Validated by: Dr. Eva Brandl, lab physician", "Validated by: Dr. Brandl, lab physician"));
  for (const sender of [eva, stefan]) {
    assert.deepEqual(held(await run({ document, sender })), { reason: "incomplete_name", sentence: "The document does not give the full name of Dr. Brandl." });
  }
});

test("the search hits must carry the document's name, however the eHVD matches names", async () => {
  // An eHVD that ignores the first name would return every Brandl, and Eva is the only one at Labor Kanalstraße.
  const lax: EhvdClient = { getGda: (query) => client.getGda(query), gdaSearch: (query) => client.gdaSearch({ ...query, firstname: undefined }) };
  const document = lab((m) => m.replace("Validated by: Dr. Eva Brandl, lab physician", "Validated by: Dr. Erika Brandl, lab physician"));
  const check = await checkRelease({ document, org: "Labor Kanalstraße", sender: stefan }, lax);
  assert.deepEqual(held(check), { reason: "not_listed", sentence: "The eHVD does not list Dr. Erika Brandl." });
});

test("the search asks for every family name that contains the document's, and compares the names itself", async () => {
  // So "Eva Maria" in the eHVD is still found for "Eva" in the document.
  const maria = editPeople((gdas) => gdas.map((gda) => (gda.id.id === EVA_OID ? { ...gda, firstname: "Eva Maria" } : gda)));
  const check = await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: stefan }, maria);
  assert.equal(check.verdict === "pass" && check.practitioner.id.id, EVA_OID);

  // The mock's Eva Brandl-Huber comes back for *Brandl* and carries the name. As an active member she makes two.
  const BRANDL_HUBER = "1.2.40.0.34.3.2.99.1.5";
  const namesake = editPeople((gdas) =>
    gdas.map((gda) => (gda.id.id === BRANDL_HUBER ? { ...gda, status: { ehvdstatus: "Aktiv", elgastatus: "Aktiv" }, relations: { ...gda.relations, memberof: [LAB_OID] } } : gda)),
  );
  assert.deepEqual(held(await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: stefan }, namesake)), {
    reason: "several_matches",
    sentence: "The eHVD lists more than one Dr. Eva Brandl at Labor Kanalstraße.",
  });
});

test("a family name too common for one answer adds the first given name, and holds when that is still too many", async () => {
  const queries: GdaSearchQuery[] = [];
  const common = (stillTooMany: boolean): EhvdClient => ({
    getGda: (query) => client.getGda(query),
    gdaSearch: async (query) => {
      if (!isPersonSearch(query)) return client.gdaSearch(query);
      queries.push(query);
      return !query.firstname || stillTooMany ? TOO_MANY : client.gdaSearch(query);
    },
  });
  const narrowed = await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: stefan }, common(false));
  assert.equal(narrowed.verdict === "pass" && narrowed.practitioner.id.id, EVA_OID);
  assert.deepEqual(queries, [
    { surname: "*Brandl*", maxResults: 200 },
    { surname: "*Brandl*", maxResults: 200, firstname: "*Eva*" },
  ]);
  assert.deepEqual(held(await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: stefan }, common(true))), {
    reason: "too_many_matches",
    sentence: "The eHVD lists too many people named Brandl to confirm Dr. Eva Brandl.",
  });
});

test("an inactive physician, or two with the same name, are held as such", async () => {
  const inactive = editPeople((gdas) => gdas.map((gda) => (gda.id.id === EVA_OID ? { ...gda, status: { ehvdstatus: "Inaktiv", elgastatus: "Inaktiv" } } : gda)));
  assert.deepEqual(held(await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: stefan }, inactive)), {
    reason: "not_active",
    sentence: "The eHVD lists Dr. Eva Brandl as not active.",
  });
  const twins = editPeople((gdas) => gdas.flatMap((gda) => (gda.id.id === EVA_OID ? [gda, { ...gda, id: { ...gda.id, id: "1.2.40.0.34.3.2.99.7.1" } }] : [gda])));
  assert.deepEqual(held(await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: stefan }, twins)), {
    reason: "several_matches",
    sentence: "The eHVD lists more than one Dr. Eva Brandl at Labor Kanalstraße.",
  });
});

test("the organisation must be listed once, under the name the request went to", async () => {
  const nowhere = lab((m) => m.replace("# Labor Kanalstraße:", "# Labor Nirgendwo:"));
  assert.deepEqual(held(await run({ document: nowhere, org: "Labor Nirgendwo" })), {
    reason: "organisation_not_listed",
    sentence: "The eHVD does not list Labor Nirgendwo as an active organisation.",
  });
  const organisations = (edit: (lab: GdaDescriptor) => GdaDescriptor[]): EhvdClient => ({
    getGda: (query) => client.getGda(query),
    gdaSearch: async (query) => {
      const result = await client.gdaSearch(query);
      return result.ok && !isPersonSearch(query) ? { ok: true, value: result.value.flatMap(edit) } : result;
    },
  });
  const twice = organisations((gda) => [gda, { ...gda, id: { ...gda.id, id: "1.2.40.0.34.3.1.99.7.1" } }]);
  const several = await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: eva }, twice);
  assert.equal(several.verdict === "hold" && several.reason, "several_organisations");
  // An eHVD that matched the name loosely and returned another lab.
  const other = organisations((gda) => [{ ...gda, surname: "Labor Woanders" }]);
  const elsewhere = await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: eva }, other);
  assert.equal(elsewhere.verdict === "hold" && elsewhere.reason, "organisation_not_listed");
  // A hold about the organisation names the organisation.
  const unsearchable = lab((m) => m.replace("# Labor Kanalstraße:", "# Labor Kanalstraße (Wien):"));
  assert.deepEqual(held(await run({ document: unsearchable, org: "Labor Kanalstraße (Wien)" })), {
    reason: "not_searchable",
    sentence: "The eHVD cannot be searched for Labor Kanalstraße (Wien).",
  });
  // Typed without ß: the eHVD matches exactly, so the heading's spelling finds the lab.
  const typed = await run({ document: lab(), org: "Labor Kanalstrasse" });
  assert.equal(typed.verdict === "pass" && typed.organisation.id.id, LAB_OID);
});

test("a physician of another specialty is held as the wrong role", async () => {
  const document = lab((m) => m.replace("# Labor Kanalstraße:", "# Klinikum Beispielstadt:").replace("Dr. Eva Brandl, lab physician", "Dr. Lena Hofer, internist"));
  assert.deepEqual(held(await run({ document, org: "Klinikum Beispielstadt", sender: stefan })), {
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
  // An answer for another OID than the one asked for.
  const swapped: EhvdClient = { getGda: () => client.getGda({ id: EVA_OID }), gdaSearch: (query) => client.gdaSearch(query) };
  const other = await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: { ...eva, gdaOid: "1.2.40.0.34.3.2.99.1.4" } }, swapped);
  assert.equal(other.verdict === "hold" && other.reason, "claim_differs");
});

test("an eHVD that is down or answers 6003 is a hold, never a pass", async () => {
  const down = await checkRelease({ document: lab(), org: "Labor Kanalstraße", sender: eva }, createEhvdClient({ url: "http://127.0.0.1:9/" }));
  assert.deepEqual(held(down), { reason: "ehvd_unreachable", sentence: "The eHVD could not be reached to confirm Labor Kanalstraße." });
  const fault = await run({ document: lab(), sender: { ...eva, gdaOid: "1.2.40.0.34.3.1.99.9.6003" } });
  assert.deepEqual(held(fault), { reason: "ehvd_error", sentence: "The eHVD answered with an error, so Dr. Eva Brandl could not be confirmed." });
});

test("the extra test documents: the release check finds the physician who validated or wrote them", async () => {
  // track/scenario/extra/index.md, column Expected. The three blocked documents stop at the patient check first.
  const extra = (file: string) => readFileSync(new URL(`../../../track/scenario/extra/${file}`, import.meta.url), "utf8");
  const sophie = { givenName: "Sophie", familyName: "Lindner-Pichler", gdaOid: null };
  const karl = { givenName: "Karl Heinz", familyName: "Moser-Wallner", gdaOid: null };
  const cases: [string, ReleaseInput["sender"], string, "claim" | "search", string][] = [
    ["lab-result-maria-beispiel-blood-count.md", eva, "Labor Kanalstraße", "claim", EVA_OID],
    ["lab-result-maria-beispiel-kidney.md", sophie, "Labor Kanalstraße", "search", EVA_OID],
    ["lab-result-maria-beispiel-metabolic.md", sophie, "Labor Kanalstraße", "search", EVA_OID],
    ["rehab-report-maria-beispiel-2025.md", stefan, "Reha Waldblick", "search", "1.2.40.0.34.3.2.99.1.3"],
    ["rehab-report-maria-beispiel-2024.md", karl, "Reha Waldblick", "search", "1.2.40.0.34.3.2.99.1.3"],
  ];
  for (const [file, sender, org, via, oid] of cases) {
    const check = await checkRelease({ document: parsed(extra(file)), org, sender }, client);
    assert.deepEqual(check.verdict === "pass" ? [check.via, check.practitioner.id.id] : check, [via, oid], file);
  }
});
