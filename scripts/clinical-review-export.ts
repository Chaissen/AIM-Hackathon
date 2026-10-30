// pnpm clinical-review:export [--out <folder>]: writes the transaction Bundle ordy would POST for each scenario and
// extra document that is expected to be filed, for the clinical review in docs/clinical-review/REVIEW_19_FHIR_DATA.md.
// Pure: parser, patient check, mappers (T12, T14), and buildFilingBundle() (T13). No Postgres, HAPI, or Keycloak.
//
// The answer flow that assembles the parties (T09, #13) is not merged yet. The parties below follow docs/FHIR.md and
// docs/IDENTITY.md, and the release check sentence follows the T09 draft. Times, the ID token, and the urn:uuid
// references are fixed, so a second run gives the same files unless the parser, the mappers, or the filing changed.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { checkAnswerPatient, uploadHash, type ExpectedPatient } from "@/server/documents/patient-check";
import { parseDocument } from "@/server/documents/parse";
import type { LabResult, PersonLine, RehabReport } from "@/server/documents/types";
import { buildFilingBundle, ID_AUSTRIA_SIMULATION, prepareParties, type Person } from "@/server/fhir/filing";
import { mapLabResult, mapRehabReport } from "@/server/fhir/mappers";

const { values } = parseArgs({ options: { out: { type: "string", default: "docs/clinical-review/19-fhir" } } });
const OUT = values.out!;

const MARIA: ExpectedPatient = { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" };
const PATIENT = { reference: "Patient/maria-beispiel" };
const ISSUER = "http://localhost:8080/realms/idaustria-sim";
const DEMO_FHIR_BASE_URL = "http://localhost:8090/fhir";

// eHVD OIDs from docs/EHVD.md, "Directory content". The release check (T15) finds the responsible person by these.
const EHVD = {
  hofer: "1.2.40.0.34.3.2.99.1.1",
  brandl: "1.2.40.0.34.3.2.99.1.2",
  leitner: "1.2.40.0.34.3.2.99.1.3",
  labor: "1.2.40.0.34.3.1.99.1.2",
  reha: "1.2.40.0.34.3.1.99.1.3",
} as const;
const RESPONSIBLE_OIDS: Record<string, string> = { "Eva Brandl": EHVD.brandl, "Johanna Leitner": EHVD.leitner };

/** A test citizen from docs/IDENTITY.md and track/scenario/extra/index.md, as the ID token names them. */
type Citizen = { given: string; family: string; birthdate: string; bpk: string; gdaOid?: string };
const CITIZENS = {
  brandl: { given: "Eva", family: "Brandl", birthdate: "1979-05-14", bpk: "GH:Njtp64gB10hpR5sYe6HxgmOQJk0=", gdaOid: EHVD.brandl },
  kern: { given: "Stefan", family: "Kern", birthdate: "1986-02-03", bpk: "GH:RF6PDuDy01ECq3HwWVdsGZpNH4A=" },
  lindnerPichler: { given: "Sophie", family: "Lindner-Pichler", birthdate: "1991-04-17", bpk: "GH:2KJhKOguN9KGwXfn3ks6G3L/3Zo=" },
  moserWallner: { given: "Karl Heinz", family: "Moser-Wallner", birthdate: "1975-08-08", bpk: "GH:pkNTMRK75YGoZ1lqSH5kAvaF37w=" },
} satisfies Record<string, Citizen>;

const ORGANISATIONS = {
  labor: { name: "Labor Kanalstraße", ehvdOid: EHVD.labor },
  reha: { name: "Reha Waldblick", ehvdOid: EHVD.reha },
};

type Answer = {
  file: string;
  /** The output file name without `.bundle.json`. Blocked documents have none. */
  name: string;
  sender: Citizen;
  organisation: { name: string; ehvdOid: string };
};

// Request 1 and 2 from track/scenario/README.md, then the documents of track/scenario/extra/index.md in its order.
const ANSWERS: Answer[] = [
  { file: "documents/lab-result-maria-beispiel.md", name: "01-request-1-lab-result", sender: CITIZENS.brandl, organisation: ORGANISATIONS.labor },
  { file: "documents/rehab-report-maria-beispiel.md", name: "02-request-2-rehab-report", sender: CITIZENS.kern, organisation: ORGANISATIONS.reha },
  { file: "extra/lab-result-maria-beispiel-blood-count.md", name: "03-extra-lab-blood-count", sender: CITIZENS.brandl, organisation: ORGANISATIONS.labor },
  { file: "extra/lab-result-maria-beispiel-kidney.md", name: "04-extra-lab-kidney", sender: CITIZENS.lindnerPichler, organisation: ORGANISATIONS.labor },
  { file: "extra/lab-result-maria-beispiel-metabolic.md", name: "05-extra-lab-metabolic", sender: CITIZENS.lindnerPichler, organisation: ORGANISATIONS.labor },
  { file: "extra/rehab-report-maria-beispiel-2025.md", name: "06-extra-rehab-2025", sender: CITIZENS.kern, organisation: ORGANISATIONS.reha },
  { file: "extra/rehab-report-maria-beispiel-2024.md", name: "07-extra-rehab-2024", sender: CITIZENS.moserWallner, organisation: ORGANISATIONS.reha },
  { file: "extra/lab-result-maria-anna-beispiel.md", name: "blocked", sender: CITIZENS.brandl, organisation: ORGANISATIONS.labor },
  { file: "extra/rehab-report-maria-beispiel-namesake.md", name: "blocked", sender: CITIZENS.kern, organisation: ORGANISATIONS.reha },
  { file: "extra/microbiology-report-johann-maria-gruber.md", name: "blocked", sender: CITIZENS.lindnerPichler, organisation: ORGANISATIONS.labor },
];

// One request day: Dr. Hofer sends at 09:00, the outside person logs in at 14:01:40 and sends at 14:02:00, and ordy
// files at 14:02:12, all Vienna time after the clock change (+01:00).
const CREATED_AT = new Date("2026-10-29T08:00:00Z");
const EXPIRES_AT = new Date("2026-11-05T08:00:00Z");
const LOGIN_AT = new Date("2026-10-29T13:01:40Z");
const SENT_AT = new Date("2026-10-29T13:02:00Z");
const FILED_AT = new Date("2026-10-29T13:02:12Z");

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

/**
 * An ID token with the claims the simulated ID Austria sends (docs/IDENTITY.md). The filing only decodes it, so the
 * signature is a placeholder: the review copy cannot be verified, a real filing carries the token Keycloak signed.
 */
function idToken(citizen: Citizen): string {
  const seconds = (date: Date) => date.getTime() / 1000;
  const gda = citizen.gdaOid && {
    "urn:eidgvat:attributes.gda": Buffer.from(JSON.stringify({ gda: { id: { oidIssuingAuthority: "1.2.40.0.34", id: citizen.gdaOid } } })).toString("base64"),
  };
  const claims = {
    iss: ISSUER,
    aud: "ordy",
    iat: seconds(LOGIN_AT),
    auth_time: seconds(LOGIN_AT),
    exp: seconds(LOGIN_AT) + 300,
    given_name: citizen.given,
    family_name: citizen.family,
    birthdate: citizen.birthdate,
    "urn:pvpgvat:oidc.bpk": citizen.bpk,
    "urn:pvpgvat:oidc.eid_ida_level": "urn:eidgvat:eid.status.full",
    "urn:pvpgvat:oidc.eid_citizen_qaa_eidas_level": "http://eidas.europa.eu/LoA/high",
    "urn:pvpgvat:oidc.eid_identity_status_level": "http://eid.gv.at/eID/status/testidentity",
    "urn:pvpgvat:oidc.pvp_version": "2.2",
    ...gda,
  };
  return `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url(claims)}.${Buffer.from("unsigned review copy").toString("base64url")}`;
}

const fullName = (person: PersonLine) => [...person.titles, person.given, person.family].filter(Boolean).join(" ");

/** Every `urn:uuid:` in order of first use becomes a fixed one, so the files only change when the content does. */
function fixUuids(json: string): string {
  const ids = new Map<string, string>();
  return json.replace(/urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (urn) => {
    if (!ids.has(urn)) ids.set(urn, `urn:uuid:00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`);
    return ids.get(urn)!;
  });
}

await mkdir(OUT, { recursive: true });
for (const old of (await readdir(OUT)).filter((name) => name.endsWith(".bundle.json"))) await rm(path.join(OUT, old));

let requestId = 0;
for (const answer of ANSWERS) {
  // The repository may check the files out with CRLF on Windows. The upload hash and the attachment use LF.
  const markdown = (await readFile(path.join("track/scenario", answer.file), "utf8")).replace(/\r\n/g, "\n");
  const parsed = parseDocument(markdown);
  if (!parsed.ok) throw new Error(`${answer.file}: ${parsed.errors.join(" ")}`);
  const doc = parsed.document;
  // The tester copies the name and the birth date from the document into the form (track/scenario/README.md).
  const patientCheck = checkAnswerPatient(doc.patient, doc.patient, MARIA);
  const blocked = !patientCheck.pass || doc.type === "other";
  if (blocked !== (answer.name === "blocked")) throw new Error(`${answer.file}: expected ${answer.name === "blocked" ? "blocked" : "filed"}`);
  if (blocked) {
    console.log(`${answer.file}: blocked (patient check ${patientCheck.pass ? "passed" : "failed"}), nothing filed`);
    continue;
  }

  requestId++;
  const responsible = doc.type === "lab-result" ? (doc as LabResult).validatedBy : (doc as RehabReport).writtenBy;
  if (!responsible) throw new Error(`${answer.file}: no responsible person`);
  const oid = RESPONSIBLE_OIDS[`${responsible.given} ${responsible.family}`];
  if (!oid) throw new Error(`${answer.file}: the eHVD has no entry for ${fullName(responsible)}`);
  // As in the T09 draft: the sender's name comes from the login. When the responsible person is the sender, the
  // sender gets the titles from the document and the OID from the GDA claim, and there is no separate author.
  const authorIsSender = responsible.given === answer.sender.given && responsible.family === answer.sender.family;
  const sender: Person = {
    given: answer.sender.given,
    family: answer.sender.family,
    ehvdOid: authorIsSender ? oid : (answer.sender.gdaOid ?? null),
    practitionerId: null,
    ...(authorIsSender ? { titles: responsible.titles } : {}),
  };
  const parties = {
    requester: { titles: ["Dr."], given: "Lena", family: "Hofer", ehvdOid: EHVD.hofer },
    sender,
    author: authorIsSender ? null : { titles: responsible.titles, given: responsible.given, family: responsible.family, ehvdOid: oid },
    organization: answer.organisation,
    identityProvider: { name: ID_AUSTRIA_SIMULATION, issuer: ISSUER },
  };
  const prepared = prepareParties(parties, { requestId, uploadSha256: uploadHash(markdown) });
  const context = { patient: PATIENT, organization: prepared.organization, practitioner: prepared.author };
  const clinical =
    doc.type === "lab-result"
      ? (({ diagnosticReport, observations }) => ({ output: diagnosticReport, others: observations }))(mapLabResult(doc, context))
      : { output: mapRehabReport(doc as RehabReport, context, FILED_AT), others: [] };
  const via = authorIsSender ? ", found by the eHVD OID in the ID Austria login" : ", found by name";
  const { bundle } = buildFilingBundle({
    request: { id: requestId, docType: doc.type === "lab-result" ? "lab-result" : "rehab-report", patient: PATIENT, createdAt: CREATED_AT, expiresAt: EXPIRES_AT },
    parties,
    prepared,
    clinical,
    idToken: idToken(answer.sender),
    sentAt: SENT_AT,
    filedAt: FILED_AT,
    acceptedByRequester: false,
    findings: [`The eHVD confirms ${fullName(responsible)} as responsible for the content at ${answer.organisation.name}${via}.`],
    fhirBaseUrl: DEMO_FHIR_BASE_URL,
  });
  const target = path.join(OUT, `${answer.name}.bundle.json`);
  await writeFile(target, `${fixUuids(JSON.stringify(bundle, null, 2))}\n`);
  console.log(`${answer.file}: request ${requestId}, ${bundle.entry?.length} entries, ${target}`);
}
