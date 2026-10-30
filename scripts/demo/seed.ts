// The body of `pnpm demo:seed` (scripts/demo-seed.ts). Fills Dr. Hofer's workspace with eleven requests in every
// state, through the code paths the widget, the portal, and the login use: tRPC as Dr. Hofer, the login route handlers
// with Keycloak's real login form, and `portal.answer` as the outside person. docs/DEMO.md, "A populated workspace".
//
// Synthetic data only, and it prints request ids, states, and document types only: never a patient's name, a link,
// a token, or a person number (docs/COMPLIANCE_AND_SAFETY.md).
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { env, mxid } from "@/env";
import { demoToolsEnabled } from "@/lib/demo-tools";
import type { DocumentType } from "@/lib/document-types";
import type { RequestInput } from "@/lib/request-input";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import type { EidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { auditLog, heldAnswers, requests, smsOutbox } from "@/server/db/schema";
import { uploadHash } from "@/server/documents/patient-check";
import type { LoginPage } from "@/server/identity/login";
import type { RequestState } from "@/server/requests/lifecycle";
import { expireDueRequests, getRequest } from "@/server/requests/service";
import { mirrorTask } from "@/server/requests/task";

import { answer, BrowserError, CITIZENS, type Citizen, openLink, visit } from "./browser";
import { LinkNotFound, openTeamInbox, tokenFromSms } from "./links";
import { BRANDL, BRANDL_EMAIL, BRANDL_EMAIL_TYPO, KERN, readDocument, SCENARIO_DOCUMENTS } from "./scenario-data";

const { values: flags } = parseArgs({ options: { force: { type: "boolean", default: false } } });

const HOFER = mxid(env.MATRIX_HOFER_USER);
const hofer = createCaller(createContext({ kind: "clinic", mxid: HOFER }));

class SeedError extends Error {}
const fail = (message: string): never => {
  throw new SeedError(message);
};

// ---------- Documents ----------

const DOCS = {
  ...SCENARIO_DOCUMENTS,
  // Validated by Dr. Martin Brandl, whom the eHVD lists, but not at Labor Kanalstraße: the release check holds it.
  mariaLiver: await readDocument("../fixtures/documents/lab-result-maria-beispiel-liver.md"),
};

// ---------- Dr. Hofer ----------

type Seeded = { id: number; docType: DocumentType; story: string };
const seeded: Seeded[] = [];

// The seed sends no email: the team inbox keeps each request email in this process (scripts/demo/links.ts).
const inbox = await openTeamInbox();

type NewRequest = Omit<RequestInput, "email" | "phone"> & ({ email: string } | { phone: string });

/** request.create as Dr. Hofer. Returns the request and its link token, or no token while it awaits confirmation. */
async function send(input: NewRequest, story: string): Promise<{ id: number; token: string | null }> {
  const result = await hofer.request.create(input);
  seeded.push({ id: result.id, docType: result.docType, story });
  if (result.state === "awaiting_confirmation") return { id: result.id, token: null };
  return { id: result.id, token: "phone" in input ? await tokenFromSms(result.id) : await inbox.tokenFromEmail(result.id, input.email) };
}

async function expectState(id: number, state: RequestState) {
  const row = (await getRequest(db, id)) ?? fail(`request ${id} does not exist`);
  if (row.state !== state) fail(`request ${id} is ${row.state}, expected ${state}`);
}

// ---------- The outside person ----------

/** Opens the link and logs in (scripts/demo/browser.ts). Returns the ID Austria session if the request is now bound. */
const login = async (token: string, citizen: Citizen, expected: LoginPage): Promise<EidSession | null> => (await visit(token, citizen, expected)).session;

// ---------- The requests ----------

async function preflight() {
  const health = await hofer.health.check();
  for (const [name, check] of Object.entries({ database: health.database, fhir: health.fhir, matrix: health.matrix })) {
    if (!check.ok) fail(`${name} is not reachable: ${check.detail}`);
  }
  if (!demoToolsEnabled) fail("NODE_ENV must not be production: the seed reads the SMS links from the demo SMS outbox, which a production build does not keep.");
  for (const id of ["maria-beispiel", "johann-muster", "petra-probst"]) {
    await hofer.clinic.patient({ id }).catch(() => fail(`Patient/${id} is not on HAPI. Run pnpm fhir:seed first.`));
  }
  const existing = await hofer.request.list();
  if (existing.length && !flags.force) {
    fail(`Dr. Hofer already has ${existing.length} requests. Run pnpm reset first, or pnpm demo:seed --force to add another set.`);
  }
}

async function seed() {
  // Request 1 (scenario): Dr. Brandl's lab result for Maria, after M2 and M3.
  const r1 = await send({ ...BRANDL, patient: "maria-beispiel", email: BRANDL_EMAIL }, "scenario request 1 with M2 and M3");
  await login(r1.token!, CITIZENS.thomas, "wrong_person"); // M2: forwarded to a colleague
  const eva1 = await login(r1.token!, CITIZENS.eva, "answer");
  await answer(r1.token!, eva1, DOCS.maxLab, "patient_mismatch"); // M3: another patient's result
  await answer(r1.token!, eva1, DOCS.mariaLab, "filed");
  await expectState(r1.id, "filed");

  // Request 2 (scenario): Stefan Kern's rehab report for Maria, by SMS.
  const r2 = await send({ ...KERN, patient: "maria-beispiel" }, "scenario request 2");
  const stefan = await login(r2.token!, CITIZENS.stefan, "answer");
  await answer(r2.token!, stefan, DOCS.mariaRehab, "filed");
  await expectState(r2.id, "filed");

  // M1 after Send anyway: the typo address belongs to Anna Huber, who fails the identity check.
  const m1 = await send({ ...BRANDL, patient: "maria-beispiel", email: BRANDL_EMAIL_TYPO }, "M1 after Send anyway");
  await expectState(m1.id, "awaiting_confirmation");
  await hofer.request.sendAnyway({ id: m1.id });
  const m1Token = await inbox.tokenFromEmail(m1.id, BRANDL_EMAIL_TYPO);
  await login(m1Token, CITIZENS.anna, "wrong_person");
  await expectState(m1.id, "sent");

  // M1 at the address warning, left for a Send anyway or Cancel in the demo.
  const m1Waiting = await send({ ...BRANDL, patient: "maria-beispiel", email: BRANDL_EMAIL_TYPO }, "M1 at the address warning");
  await expectState(m1Waiting.id, "awaiting_confirmation");

  // Identity held: Dr. Hofer typed a second given name, so Eva Brandl matches only in part.
  const held = await send({ ...BRANDL, given: "Eva Maria", patient: "johann-muster", email: BRANDL_EMAIL }, "partial name match");
  await login(held.token!, CITIZENS.eva, "held");
  await expectState(held.id, "identity_held");

  // Answer held: the result names Dr. Martin Brandl as validator, and the eHVD does not list him at the lab.
  const answerHeld = await send({ ...BRANDL, patient: "maria-beispiel", email: BRANDL_EMAIL }, "release check holds the answer");
  const eva2 = await login(answerHeld.token!, CITIZENS.eva, "answer");
  await answer(answerHeld.token!, eva2, DOCS.mariaLiver, "held");
  await expectState(answerHeld.id, "answer_held");

  // Sent: nobody has opened it yet.
  await send(
    { docType: "rehab-report", given: "Karl Heinz", family: "Moser-Wallner", org: "Reha Waldblick", patient: "johann-muster", phone: "+43 660 000 0102" },
    "not opened yet",
  );

  // Verified: Dr. Brandl logged in and has not uploaded yet.
  const verified = await send({ ...BRANDL, patient: "petra-probst", email: BRANDL_EMAIL }, "logged in, no upload yet");
  await login(verified.token!, CITIZENS.eva, "answer");
  await expectState(verified.id, "verified");

  // Cancelled by Dr. Hofer.
  const cancelled = await send({ ...KERN, patient: "maria-beispiel" }, "cancelled by Dr. Hofer");
  await hofer.request.cancel({ id: cancelled.id });
  await expectState(cancelled.id, "cancelled");

  // Expired: opened, never answered. A seed run cannot wait seven days, so it moves this one request's expiry into the
  // past and lets the request service expire it, which also clears its ID token and any held answer.
  const expired = await send({ ...KERN, patient: "petra-probst" }, "expired after the link was opened");
  if (!(await openLink(expired.token!, CITIZENS.stefan))) fail("the link did not open");
  await db.update(requests).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(requests.id, expired.id));
  if (!(await expireDueRequests(db, expired.id)).includes(expired.id)) fail(`request ${expired.id} did not expire`);
  // expireDueRequests mirrors the Task without waiting for it. Mirror it once more and wait, so the run ends with it.
  await sleep(500);
  await mirrorTask((await getRequest(db, expired.id))!);
  await expectState(expired.id, "expired");

  // Locked: three people who are not Dr. Brandl, among them the second Eva Brandl, whose person number differs.
  const locked = await send({ ...BRANDL, patient: "johann-muster", email: BRANDL_EMAIL }, "locked after three failed checks");
  await login(locked.token!, CITIZENS.thomas, "wrong_person");
  await login(locked.token!, CITIZENS.eva2, "wrong_person");
  await login(locked.token!, CITIZENS.anna, "wrong_person");
  await expectState(locked.id, "locked");
}

// ---------- The data rules ----------

/**
 * The rules of docs/COMPLIANCE_AND_SAFETY.md ("Data we keep") on what this run stored: no closed request keeps an ID
 * token or an SMS in the demo outbox, a held answer exists only for a request in answer_held, the wrong-patient upload
 * left only its hash and booleans, and no audit entry holds document text.
 */
async function checkStoredData(ids: number[]): Promise<string[]> {
  const problems: string[] = [];
  const closed = await db
    .select({ id: requests.id })
    .from(requests)
    .where(and(inArray(requests.id, ids), inArray(requests.state, ["filed", "cancelled", "expired", "locked"]), isNotNull(requests.idToken)));
  if (closed.length) problems.push(`closed requests with an ID token: ${closed.map((r) => r.id).join(", ")}`);

  const closedSms = await db
    .select({ id: smsOutbox.requestId })
    .from(smsOutbox)
    .innerJoin(requests, eq(requests.id, smsOutbox.requestId))
    .where(and(inArray(smsOutbox.requestId, ids), inArray(requests.state, ["filed", "cancelled", "expired", "locked"])));
  if (closedSms.length) problems.push(`closed requests with an SMS in the outbox: ${[...new Set(closedSms.map((r) => r.id))].join(", ")}`);

  const held = await db.select({ id: heldAnswers.requestId, state: requests.state }).from(heldAnswers).innerJoin(requests, eq(requests.id, heldAnswers.requestId));
  const stray = held.filter((h) => ids.includes(h.id) && h.state !== "answer_held");
  if (stray.length) problems.push(`held answers outside answer_held: ${stray.map((h) => h.id).join(", ")}`);

  const audit = await db.select().from(auditLog).where(inArray(auditLog.requestId, ids));
  const mismatch = audit.filter((a) => a.event === "misdelivery_caught" && a.outcome === "patient_mismatch");
  const maxHash = uploadHash(DOCS.maxLab.bytes);
  if (!mismatch.some((a) => a.detail.sha256 === maxHash)) problems.push("no patient_mismatch entry with the hash of the Max Beispiel upload");
  for (const a of mismatch) {
    const keys = Object.keys(a.detail).sort().join(",");
    if (keys !== "birthDateMatches,nameMatches,sha256,size") problems.push(`audit entry ${a.id} keeps more than the hash: ${keys}`);
  }

  // Every line of an uploaded document that is longer than a name, such as "Patient: Max Beispiel, born 3 July 1958".
  const lines = Object.values(DOCS).flatMap((doc) =>
    new TextDecoder()
      .decode(doc.bytes)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 20),
  );
  const text = audit.map((a) => JSON.stringify(a.detail));
  const leaked = audit.filter((_, i) => lines.some((line) => text[i].includes(JSON.stringify(line).slice(1, -1))));
  if (leaked.length) problems.push(`audit entries with document text: ${leaked.map((a) => a.id).join(", ")}`);
  if (text.some((t) => t.includes("Max Beispiel") || t.includes("1958"))) problems.push("the audit log names the other patient");
  return problems;
}

// ---------- Run ----------

let ok = false;
try {
  await preflight();
  console.log(`pnpm demo:seed: filling the workspace of ${HOFER}${flags.force ? " (--force)" : ""}\n`);
  await seed();
  const problems = await checkStoredData(seeded.map((s) => s.id));
  const list = new Map((await hofer.request.list()).map((r) => [r.id, r]));
  console.log("id  state                  document      story");
  for (const s of seeded) console.log(`${String(s.id).padEnd(3)} ${(list.get(s.id)?.state ?? "missing").padEnd(22)} ${s.docType.padEnd(13)} ${s.story}`);
  console.log("");
  if (problems.length) for (const p of problems) console.error(`DATA RULE FAILED: ${p}`);
  else console.log("Data rules hold: no closed request keeps an ID token or an SMS, the wrong-patient upload left only its hash, and the audit log holds no document text.");
  ok = problems.length === 0;
} catch (error) {
  // SeedError, BrowserError, and LinkNotFound messages name request ids, states, and usernames only. Anything else could carry a token, so only its type.
  console.error(`pnpm demo:seed stopped: ${error instanceof SeedError || error instanceof BrowserError || error instanceof LinkNotFound ? error.message : error instanceof Error ? `${error.name}: ${error.message.split("\n")[0]}` : "unknown error"}`);
  if (seeded.length) console.error(`Requests created so far: ${seeded.map((s) => s.id).join(", ")}. pnpm reset removes them.`);
} finally {
  await inbox.close();
  await db.$client.end();
}
process.exit(ok ? 0 : 1);
