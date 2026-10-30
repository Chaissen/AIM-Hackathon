// pnpm scenario [--no-validate]: runs request 1, M1 to M3, and request 2 against the running stack and writes the
// four metric results to out/metrics/ (docs/WHITEPAPER.md, "How we measure the metrics"). Start `pnpm dev` first.
//
// Each step has two parts. `act` drives the flow the way Dr. Hofer and the outside person would: Dr. Hofer through the
// tRPC router, the outside person through the link in Mailpit or on the SMS screen, the simulated ID Austria, and the
// portal (scripts/demo/browser.ts). `verify` checks the result in the audit log, on HAPI, and in Matrix. Only entries
// written after the start of the run count. The start comes from the clocks that write them: Postgres `now()` for the
// audit log, the newest room event for Matrix.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { gte, sql } from "drizzle-orm";

import { env, mxid } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import type { AnswerOutcome } from "@/server/answers/submit";
import type { EidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import type { LoginPage } from "@/server/identity/login";
import { listInboxEmails } from "@/server/mail/mailpit";
import { getBotClient, roomAlias, type MatrixEvent } from "@/server/matrix/client";
import { coverageLines, effortSeconds, filedReferences, misdeliveryCaught, requestCoverage, type AuditRow, type MisdeliveryKind } from "@/server/metrics/audit";
import { scanForNotice } from "@/server/metrics/notice-check";
import { revealedOnPage } from "@/server/metrics/page-check";
import {
  coverageMetric,
  effortMetric,
  METRICS_DIR,
  metricsMarkdown,
  misdeliveryMetric,
  validationMetric,
  type Metric,
  type StepResult,
  type ValidationRun,
} from "@/server/metrics/report";
import { exportResources, runValidator } from "@/server/metrics/validator";
import { findAnswerContext } from "@/server/portal/data";

import { CITIZENS, type Citizen, currentToken, type Login, logIn, openLink, tokenFromSms, upload } from "./demo/browser";

const { values: flags } = parseArgs({ options: { "no-validate": { type: "boolean", default: false } } });

type Ctx = {
  // The start of the run on the Postgres clock, set by the preflight step. Until then the local clock.
  since: Date;
  // Dr. Hofer's room and its newest event at the start of the run, set by the preflight step.
  roomId?: string;
  matrixMark?: string;
  // Request ids, set by `act`.
  r1?: number;
  m1?: number;
  r2?: number;
  // Request 1's link from Mailpit, and Dr. Brandl's ID Austria session for it, set by `act`.
  r1Token?: string;
  eva?: EidSession;
  // The page the wrong person saw after the ID Austria login in M1, set by `act`.
  m1Page?: string;
};

const PATIENT = { name: "Maria Beispiel", birthDate: "1961-03-12" };

type Step = {
  id: string;
  title: string;
  act?: (ctx: Ctx) => Promise<void>;
  verify: (ctx: Ctx) => Promise<string>;
};

class CheckFailed extends Error {}
const fail = (message: string): never => {
  throw new CheckFailed(message);
};
const need = <T>(value: T | undefined, what: string): T => value ?? fail(`${what} is not set; its act step did not run`);

const rowsSince = (ctx: Ctx) => db.select().from(auditLog).where(gte(auditLog.at, ctx.since)).orderBy(auditLog.at, auditLog.id);

async function expectEvent(ctx: Ctx, requestId: number, event: AuditRow["event"]): Promise<AuditRow> {
  const row = (await rowsSince(ctx)).find((r) => r.requestId === requestId && r.event === event);
  return row ?? fail(`no ${event} entry for request ${requestId}`);
}

async function expectMisdelivery(ctx: Ctx, requestId: number, kind: MisdeliveryKind): Promise<AuditRow> {
  return misdeliveryCaught(await rowsSince(ctx), requestId, kind, ctx.since) ?? fail(`no misdelivery_caught: ${kind} for request ${requestId}`);
}

async function expectNotFiled(ctx: Ctx, requestId: number) {
  const rows = (await rowsSince(ctx)).filter((r) => r.requestId === requestId && r.event === "answer_filed");
  if (rows.length) fail(`request ${requestId} has an answer_filed entry`);
}

// Postgres writes `audit_log.at` with `now()`, so the run starts on that clock, not on this machine's.
async function databaseNow(): Promise<Date> {
  const [row] = await db.execute<{ epoch: string | number }>(sql`select extract(epoch from now()) as epoch`);
  // Date truncates to milliseconds, so the start is never later than Postgres' own `now()`.
  return new Date(Number(row.epoch) * 1000);
}

type MessagesPage = { chunk: MatrixEvent[]; end?: string };
const roomMessages = async (roomId: string, limit: number, from?: string) =>
  (await getBotClient()).request<MessagesPage>(
    "GET",
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${limit}${from ? `&from=${encodeURIComponent(from)}` : ""}`,
  );

// A notice in Dr. Hofer's room that is newer than the mark, found by a part of its text. Reads back page by page.
async function expectNotice(ctx: Ctx, text: string): Promise<string> {
  const roomId = need(ctx.roomId, "Dr. Hofer's room");
  const mark = need(ctx.matrixMark, "the Matrix mark");
  let from: string | undefined;
  for (let pages = 0; pages < 10; pages++) {
    const page = await roomMessages(roomId, 100, from);
    const scan = scanForNotice(page.chunk, mark, text);
    if (scan.hit) return String(scan.hit.content.body);
    if (scan.reachedMark || !page.end || !page.chunk.length) break;
    from = page.end;
  }
  return fail(`no notice containing "${text}" in ${roomAlias()} since the start of the run`);
}

async function reachable(name: string, url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch((e: Error) => fail(`${name} not reachable at ${url}: ${e.message}`));
  if (!res.ok) fail(`${name} answered ${res.status} at ${url}`);
}

const hofer = createCaller(createContext({ kind: "clinic", mxid: mxid(env.MATRIX_HOFER_USER) }));
const BRANDL = { docType: "lab-result", patient: "maria-beispiel", given: "Eva", family: "Brandl", org: "Labor Kanalstraße" } as const;

/** The link token in the email Mailpit caught for this request. */
async function tokenFromMailpit(requestId: number, address: string): Promise<string> {
  const inbox = await listInboxEmails();
  if (inbox.status !== "ok") return fail(`Mailpit cannot be reached at ${env.MAILPIT_API_URL}`);
  const texts = inbox.emails.filter((email) => email.to.some((to) => to.toLowerCase() === address.toLowerCase())).map((email) => email.text);
  return (await currentToken(requestId, texts)) ?? fail(`no email in Mailpit for request ${requestId}`);
}

/** Opens the link and logs in at the simulated ID Austria. Fails unless the person lands on the expected page. */
async function login(token: string, citizen: Citizen, expected: LoginPage): Promise<Login> {
  if (!(await openLink(token, citizen))) fail(`the link did not open for ${citizen.username}`);
  const result = await logIn(token, citizen);
  if (result.page !== expected) fail(`${citizen.username} landed on ${result.page}, expected ${expected}`);
  return result;
}

/** Uploads a scenario document, typing the patient's name and birth date as the answer page shows them. */
async function answer(token: string, session: EidSession, file: string, expected: AnswerOutcome["outcome"]) {
  const page = (await findAnswerContext(token, session)) ?? fail("the answer page did not open");
  const bytes = new Uint8Array(await readFile(new URL(`../track/scenario/documents/${file}`, import.meta.url)));
  const outcome = await upload(token, session, { name: file, bytes }, { name: page.patient.name, birthDate: page.patient.birthDate });
  if (outcome.outcome !== expected) fail(`the upload ended as ${outcome.outcome}, expected ${expected}`);
}

const steps: Step[] = [
  {
    id: "preflight",
    title: "The stack is up",
    verify: async (ctx) => {
      const h = await createCaller(createContext({ kind: "anonymous" })).health.check();
      for (const [name, c] of Object.entries({ database: h.database, fhir: h.fhir, matrix: h.matrix })) if (!c.ok) fail(`${name}: ${c.detail}`);
      await reachable("ordy", `${env.PUBLIC_URL}/api/healthz`);
      await reachable("Keycloak", env.OIDC_METADATA_URL);
      await reachable("Mailpit", `${env.MAILPIT_API_URL}/api/v1/info`);
      ctx.since = await databaseNow();
      ctx.roomId = (await (await getBotClient()).resolveAlias(roomAlias())) ?? fail(`room ${roomAlias()} not found`);
      ctx.matrixMark = (await roomMessages(ctx.roomId, 1)).chunk[0]?.event_id ?? fail(`room ${roomAlias()} has no events`);
      return `Postgres, HAPI, Synapse, ordy, Keycloak, and Mailpit answer; the run starts at ${ctx.since.toISOString()} on the Postgres clock`;
    },
  },
  {
    id: "request-1",
    title: "Request 1: Dr. Hofer asks Dr. Brandl for the lab result by email",
    act: async (ctx) => {
      const r1 = await hofer.request.create({ ...BRANDL, email: "eva.brandl@labor-kanal.example" });
      ctx.r1 = r1.id;
      if (r1.state !== "sent") fail(`request 1 is ${r1.state}, expected sent`);
      ctx.r1Token = await tokenFromMailpit(r1.id, "eva.brandl@labor-kanal.example");
    },
    verify: async (ctx) => {
      const sent = await expectEvent(ctx, need(ctx.r1, "request 1"), "request_sent");
      return `request ${sent.requestId} sent by ${sent.actor}`;
    },
  },
  {
    id: "m1",
    title: "M1: wrong address, opened by someone else",
    // Request 1 again, to the mistyped address, which belongs to Anna Huber. After Send anyway she opens the link.
    act: async (ctx) => {
      const address = "eva.brandl@labor-kanaI.example";
      const m1 = await hofer.request.create({ ...BRANDL, email: address });
      ctx.m1 = m1.id;
      if (m1.state !== "awaiting_confirmation") fail(`the M1 request is ${m1.state}, expected awaiting_confirmation`);
      await hofer.request.sendAnyway({ id: m1.id });
      const { landing, cookies } = await login(await tokenFromMailpit(m1.id, address), CITIZENS.anna, "wrong_person");
      const page = await fetch(landing, { headers: { cookie: cookies.join("; ") }, signal: AbortSignal.timeout(30_000) });
      if (!page.ok) fail(`the page after the M1 login answered ${page.status}`);
      ctx.m1Page = await page.text();
    },
    // Caught if the person cannot see the patient or the document type, cannot answer, and the failed identity check is logged.
    verify: async (ctx) => {
      const m1 = need(ctx.m1, "the M1 request");
      const shown = revealedOnPage(need(ctx.m1Page, "the page after the M1 login"), PATIENT);
      if (shown.length) fail(`the page after the login shows ${shown.join(", ")}`);
      const caught = await expectMisdelivery(ctx, m1, "wrong_person");
      const rows = (await rowsSince(ctx)).filter((r) => r.requestId === m1);
      if (!rows.some((r) => r.event === "identity_checked" && r.outcome === "fail" && r.actor === caught.actor)) {
        fail(`no identity_checked: fail for ${caught.actor} on request ${m1}`);
      }
      if (rows.some((r) => r.event === "answer_sent")) fail(`request ${m1} has an answer_sent entry`);
      await expectNotFiled(ctx, m1);
      const address = misdeliveryCaught(rows, m1, "address_mismatch", ctx.since);
      return `identity_checked: fail and wrong_person logged for ${caught.actor}, nothing shown${address ? ", address_mismatch logged before sending" : ""}`;
    },
  },
  {
    id: "m2",
    title: "M2: request 1 forwarded to a colleague",
    act: async (ctx) => {
      await login(need(ctx.r1Token, "request 1's link"), CITIZENS.thomas, "wrong_person");
    },
    verify: async (ctx) => {
      const r1 = need(ctx.r1, "request 1");
      const caught = await expectMisdelivery(ctx, r1, "wrong_person");
      await expectNotFiled(ctx, r1);
      return `wrong_person logged for ${caught.actor}`;
    },
  },
  {
    id: "m3",
    title: "M3: Dr. Brandl answers with Max Beispiel's result",
    act: async (ctx) => {
      const token = need(ctx.r1Token, "request 1's link");
      const { session } = await login(token, CITIZENS.eva, "answer");
      ctx.eva = session ?? fail("the login gave Dr. Brandl no ID Austria session");
      await answer(token, ctx.eva, "lab-result-max-beispiel.md", "patient_mismatch");
    },
    verify: async (ctx) => {
      const r1 = need(ctx.r1, "request 1");
      await expectMisdelivery(ctx, r1, "patient_mismatch");
      await expectNotFiled(ctx, r1);
      await expectNotice(ctx, "is about a different patient");
      return "patient_mismatch logged, nothing filed, Dr. Hofer told in Matrix";
    },
  },
  {
    id: "request-1-answer",
    title: "Request 1: Dr. Brandl answers with Maria Beispiel's result",
    act: async (ctx) => {
      await answer(need(ctx.r1Token, "request 1's link"), need(ctx.eva, "Dr. Brandl's session"), "lab-result-maria-beispiel.md", "filed");
    },
    verify: async (ctx) => {
      const filed = await expectEvent(ctx, need(ctx.r1, "request 1"), "answer_filed");
      const refs = filedReferences([filed]);
      if (!refs.length) fail("the answer_filed entry names no FHIR resources");
      return `${refs.length} resources filed`;
    },
  },
  {
    id: "request-2",
    title: "Request 2: Stefan Kern sends the rehab discharge report after an SMS",
    act: async (ctx) => {
      const kern = { given: "Stefan", family: "Kern", org: "Reha Waldblick", phone: "+43 660 000 0101" };
      const r2 = await hofer.request.create({ docType: "rehab-report", patient: "maria-beispiel", ...kern });
      ctx.r2 = r2.id;
      const token = (await tokenFromSms(r2.id)) ?? fail(`no SMS for request ${r2.id}`);
      const { session } = await login(token, CITIZENS.stefan, "answer");
      await answer(token, session ?? fail("the login gave Stefan Kern no ID Austria session"), "rehab-report-maria-beispiel.md", "filed");
    },
    verify: async (ctx) => {
      const r2 = need(ctx.r2, "request 2");
      await expectEvent(ctx, r2, "request_sent");
      const filed = await expectEvent(ctx, r2, "answer_filed");
      return `${filedReferences([filed]).length} resources filed`;
    },
  },
];

async function runSteps(ctx: Ctx): Promise<StepResult[]> {
  const results: StepResult[] = [];
  let stackDown = false;
  for (const step of steps) {
    const base = { id: step.id, title: step.title };
    if (stackDown) results.push({ ...base, status: "skipped", detail: "the stack is not up" });
    else {
      try {
        await step.act?.(ctx);
        results.push({ ...base, status: "pass", detail: await step.verify(ctx) });
      } catch (e) {
        results.push({ ...base, status: "fail", detail: e instanceof Error ? e.message : String(e) });
        if (step.id === "preflight") stackDown = true;
      }
    }
    const r = results.at(-1)!;
    console.log(`${r.status.toUpperCase().padEnd(7)} ${r.title}\n        ${r.detail}`);
  }
  return results;
}

async function validate(refs: string[]): Promise<ValidationRun> {
  if (!refs.length) return { kind: "nothing_filed" };
  if (flags["no-validate"]) return { kind: "skipped", resources: refs.length };
  try {
    const files = await exportResources(refs);
    return { kind: "done", files: files.length, results: await runValidator(files, path.join(METRICS_DIR, "validator-output.json")) };
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

async function measure(ctx: Ctx, results: StepResult[]) {
  const rows = results[0].status === "pass" ? await rowsSince(ctx) : [];
  const coverage = [ctx.r1, ctx.r2].flatMap((id) => (id === undefined ? [] : [requestCoverage(id, rows)]));
  for (const c of coverage) console.log(coverageLines(c).join("\n"));
  const references = filedReferences(rows);
  const run = await validate(references);
  const validation = run.kind === "done" ? { at: new Date(), files: run.files, references, results: run.results } : null;
  const metrics = [
    validationMetric(run),
    effortMetric(ctx.r1 === undefined ? null : effortSeconds(rows, ctx.r1)),
    misdeliveryMetric(results),
    coverageMetric(coverage.find((c) => c.requestId === ctx.r1)),
  ];
  return { metrics, validation };
}

const ctx: Ctx = { since: new Date() };
console.log(`pnpm scenario: started ${ctx.since.toISOString()}\n`);
let results: StepResult[] = [];
let metrics: Metric[] = [];
let validation: Awaited<ReturnType<typeof measure>>["validation"] = null;
try {
  results = await runSteps(ctx);
  console.log("");
  ({ metrics, validation } = await measure(ctx, results));
} finally {
  await db.$client.end();
}

const markdown = metricsMarkdown(metrics, ctx.since);
await mkdir(METRICS_DIR, { recursive: true });
await writeFile(path.join(METRICS_DIR, "scenario.json"), JSON.stringify({ at: ctx.since, requests: { r1: ctx.r1, m1: ctx.m1, r2: ctx.r2 }, steps: results, metrics, validation }, null, 2));
await writeFile(path.join(METRICS_DIR, "metrics.md"), markdown);
console.log(`\n${markdown}\nWritten to ${path.join(METRICS_DIR, "metrics.md")} and scenario.json.`);
process.exit(results.every((r) => r.status === "pass") && metrics.every((m) => m.status === "met") ? 0 : 1);
