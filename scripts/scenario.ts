// pnpm scenario [--no-validate] [--web <url>]: runs request 1, M1 to M3, and request 2 against the running stack and
// writes the four metric results to out/metrics/ (docs/WHITEPAPER.md, "How we measure the metrics").
//
// Each step has two parts. `act` drives the flow the way Dr. Hofer and the outside person would, through the code paths
// `pnpm demo:seed` uses (scripts/demo/): tRPC as Dr. Hofer, the login route handlers in this process with Keycloak's
// real login form, and `portal.answer` as the outside person. `verify` checks the result in the audit log, on HAPI, in
// Matrix, and, for M1, in the HTML the web server sends. Only entries written after the start of the run count. The
// start comes from the clocks that write them: Postgres `now()` for the audit log, the newest room event for Matrix.
//
// It needs Postgres, HAPI, Synapse, Keycloak, the eHVD mock, and the web server (`pnpm dev`), which serves the page
// the wrong person sees in M1. `--web` names another web server than PUBLIC_URL; the logins still go through PUBLIC_URL,
// the redirect URI Keycloak allows. It sends no email: the request emails stay in this process (scripts/demo/links.ts).
//
// It never prints or writes a link token, a session, a patient's name, or document text (docs/COMPLIANCE_AND_SAFETY.md).
// The login route handlers sign their cookies with ORDY_SECRET; ./demo/ordy-secret makes up a key when .env has none.
// It must stay the first import: src/env.ts reads ORDY_SECRET once, when it loads.
import "./demo/ordy-secret";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { DrizzleQueryError, gte, sql } from "drizzle-orm";

import { env, mxid } from "@/env";
import { demoToolsEnabled } from "@/lib/demo-tools";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import type { EidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { getBotClient, roomAlias, type MatrixEvent } from "@/server/matrix/client";
import {
  coverageLines,
  effortSeconds,
  filedReferences,
  misdeliveryCaught,
  requestCoverage,
  type AuditRow,
  type MisdeliveryKind,
  type RequestCoverage,
} from "@/server/metrics/audit";
import { scanForNotice } from "@/server/metrics/notice-check";
import { pageText, revealedOnPage } from "@/server/metrics/page-check";
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
import { getRequest } from "@/server/requests/service";

import { answer, BrowserError, CITIZENS, viewPage, visit } from "./demo/browser";
import { LinkNotFound, openTeamInbox, tokenFromSms } from "./demo/links";
import { BRANDL, BRANDL_EMAIL, BRANDL_EMAIL_TYPO, KERN, SCENARIO_DOCUMENTS as DOCS } from "./demo/scenario-data";

const { values: flags } = parseArgs({ options: { "no-validate": { type: "boolean", default: false }, web: { type: "string" } } });
const WEB_URL = new URL(flags.web ?? env.PUBLIC_URL).origin;

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
  // The page the wrong person saw after the ID Austria login in M1, and the page she ended on when she then tried the
  // answer page, set by `act`.
  m1Page?: string;
  m1AnswerPage?: string;
};

// What the outside person holds: the link tokens from the email and the SMS, and Dr. Brandl's ID Austria session.
// Kept out of Ctx, so nothing of it can reach the output or out/metrics/.
const held: { r1?: string; m1?: string; r2?: string; brandl?: EidSession | null } = {};

const PATIENT_ID = "maria-beispiel";
const PATIENT = { name: "Maria Beispiel", birthDate: "1961-03-12" };

const hofer = createCaller(createContext({ kind: "clinic", mxid: mxid(env.MATRIX_HOFER_USER) }));

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

// The step's detail, which goes to the console and to scenario.json. Only messages written to name ids, states,
// usernames, and outcomes go out in full. A database error's message lists the query's parameters (names, tokens,
// document text), so it never does, and any other error gives its first line only.
function safeMessage(error: unknown): string {
  if (error instanceof CheckFailed || error instanceof BrowserError || error instanceof LinkNotFound) return error.message;
  if (error instanceof DrizzleQueryError) return "a database query failed";
  return error instanceof Error ? `${error.name}: ${error.message.split("\n")[0]}` : "unknown error";
}

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

async function expectState(id: number, state: string) {
  const row = (await getRequest(db, id)) ?? fail(`request ${id} does not exist`);
  if (row.state !== state) fail(`request ${id} is ${row.state}, expected ${state}`);
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

// A notice in Dr. Hofer's room that is newer than the mark, found by a part of its text, and with `threadRoot` only in
// that request's thread. Reads back page by page.
async function expectNotice(ctx: Ctx, text: string, threadRoot?: string): Promise<string> {
  const roomId = need(ctx.roomId, "Dr. Hofer's room");
  const mark = need(ctx.matrixMark, "the Matrix mark");
  let from: string | undefined;
  for (let pages = 0; pages < 10; pages++) {
    const page = await roomMessages(roomId, 100, from);
    const scan = scanForNotice(page.chunk, mark, text, threadRoot);
    if (scan.hit) return String(scan.hit.content.body);
    if (scan.reachedMark || !page.end || !page.chunk.length) break;
    from = page.end;
  }
  return fail(`no notice containing "${text}"${threadRoot ? " in the request's thread" : ""} in ${roomAlias()} since the start of the run`);
}

// An audit actor as the step details name it: "Anna Huber", without the person number the audit log keeps with it.
const who = (actor: string) => actor.replace(/\s*\([^)]*\)$/, "");

async function reachable(name: string, url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch((e: Error) => fail(`${name} not reachable at ${url}: ${e.message}`));
  if (!res.ok) fail(`${name} answered ${res.status} at ${url}`);
}

const steps: Step[] = [
  {
    id: "preflight",
    title: "The stack is up",
    verify: async (ctx) => {
      const h = await createCaller(createContext({ kind: "anonymous" })).health.check();
      for (const [name, c] of Object.entries({ database: h.database, fhir: h.fhir, matrix: h.matrix })) if (!c.ok) fail(`${name}: ${c.detail}`);
      if (!demoToolsEnabled) fail("NODE_ENV is production: request 2 reads its link from the demo SMS outbox, which a production build does not keep");
      await reachable("Keycloak", env.OIDC_METADATA_URL);
      await reachable("the eHVD mock", new URL("healthz", env.EHVD_URL).href);
      // Only M1 needs the web server: it fetches the page the wrong person sees after the login.
      await reachable("the web server", new URL("/api/healthz", WEB_URL).href);
      await hofer.clinic.patient({ id: PATIENT_ID }).catch(() => fail(`Patient/${PATIENT_ID} is not on HAPI. Run pnpm fhir:seed first.`));
      ctx.since = await databaseNow();
      ctx.roomId = (await (await getBotClient()).resolveAlias(roomAlias())) ?? fail(`room ${roomAlias()} not found`);
      ctx.matrixMark = (await roomMessages(ctx.roomId, 1)).chunk[0]?.event_id ?? fail(`room ${roomAlias()} has no events`);
      return `Postgres, HAPI, Synapse, Keycloak, the eHVD mock, and the web server at ${WEB_URL} answer; the run starts at ${ctx.since.toISOString()} on the Postgres clock`;
    },
  },
  {
    id: "request-1",
    title: "Request 1: Dr. Hofer asks Dr. Brandl for the lab result by email",
    // The widget's request form makes the same call. The link comes from the email to Dr. Brandl in the team inbox.
    act: async (ctx) => {
      const sent = await hofer.request.create({ ...BRANDL, patient: PATIENT_ID, email: BRANDL_EMAIL });
      ctx.r1 = sent.id;
      if (sent.state !== "sent") fail(`request ${sent.id} is ${sent.state}, expected sent`);
      held.r1 = await inbox.tokenFromEmail(sent.id, BRANDL_EMAIL);
    },
    verify: async (ctx) => {
      const sent = await expectEvent(ctx, need(ctx.r1, "request 1"), "request_sent");
      return `request ${sent.requestId} sent by ${sent.actor}`;
    },
  },
  {
    id: "m1",
    title: "M1: wrong address, opened by someone else",
    // Request 1 again, to the mistyped address. The address check holds it, Dr. Hofer clicks Send anyway, and Anna
    // Huber, who owns the mistyped address, opens the link, logs in, and then tries the answer page.
    act: async (ctx) => {
      const sent = await hofer.request.create({ ...BRANDL, patient: PATIENT_ID, email: BRANDL_EMAIL_TYPO });
      ctx.m1 = sent.id;
      if (sent.state !== "awaiting_confirmation") fail(`request ${sent.id} is ${sent.state}, expected awaiting_confirmation`);
      await hofer.request.sendAnyway({ id: sent.id });
      held.m1 = await inbox.tokenFromEmail(sent.id, BRANDL_EMAIL_TYPO);
      const login = await visit(held.m1, CITIZENS.anna, "wrong_person");
      ctx.m1Page = await viewPage(WEB_URL, login);
      ctx.m1AnswerPage = await viewPage(WEB_URL, login, `/r/${encodeURIComponent(held.m1)}/answer`);
    },
    // Caught if the person cannot see the patient or the document type, cannot answer, and the failed identity check is logged.
    verify: async (ctx) => {
      const m1 = need(ctx.m1, "the M1 request");
      // So the check below never passes on an error page that shows nothing.
      if (!pageText(need(ctx.m1Page, "the page after the M1 login")).includes("This request is for someone else")) {
        fail("the page after the login is not the refusal page");
      }
      for (const [what, html] of [
        ["the page after the login", need(ctx.m1Page, "the page after the M1 login")],
        ["the answer page", need(ctx.m1AnswerPage, "the answer page in M1")],
      ] as const) {
        const shown = revealedOnPage(html, PATIENT);
        if (shown.length) fail(`${what} shows ${shown.join(", ")}`);
      }
      if (/<input\b[^>]*type="file"/i.test(ctx.m1AnswerPage!)) fail("the answer page offers the upload to the wrong person");
      const caught = await expectMisdelivery(ctx, m1, "wrong_person");
      const rows = (await rowsSince(ctx)).filter((r) => r.requestId === m1);
      if (!rows.some((r) => r.event === "identity_checked" && r.outcome === "fail" && r.actor === caught.actor)) {
        fail(`no identity_checked: fail for ${who(caught.actor)} on request ${m1}`);
      }
      if (rows.some((r) => r.event === "answer_sent")) fail(`request ${m1} has an answer_sent entry`);
      await expectNotFiled(ctx, m1);
      const address = misdeliveryCaught(rows, m1, "address_mismatch", ctx.since);
      return `identity_checked: fail and wrong_person logged for ${who(caught.actor)}, refusal page shows nothing, answer page offers no upload${address ? ", address_mismatch logged before sending" : ""}`;
    },
  },
  {
    id: "m2",
    title: "M2: request 1 forwarded to a colleague",
    act: async () => {
      await visit(need(held.r1, "the request 1 link"), CITIZENS.thomas, "wrong_person");
    },
    verify: async (ctx) => {
      const r1 = need(ctx.r1, "request 1");
      const caught = await expectMisdelivery(ctx, r1, "wrong_person");
      await expectNotFiled(ctx, r1);
      return `wrong_person logged for ${who(caught.actor)}`;
    },
  },
  {
    id: "m3",
    title: "M3: Dr. Brandl answers with another patient's lab result",
    act: async () => {
      const token = need(held.r1, "the request 1 link");
      held.brandl = (await visit(token, CITIZENS.eva, "answer")).session;
      await answer(token, held.brandl, DOCS.maxLab, "patient_mismatch");
    },
    verify: async (ctx) => {
      const r1 = need(ctx.r1, "request 1");
      await expectMisdelivery(ctx, r1, "patient_mismatch");
      await expectNotFiled(ctx, r1);
      // The "Request … sent" notice started the request's thread; the mismatch notice must be a reply in it.
      const thread = (await getRequest(db, r1))?.matrixEvent ?? fail(`request ${r1} has no thread in Matrix`);
      await expectNotice(ctx, `The answer to request ${r1} is about a different patient`, thread);
      return "patient_mismatch logged, nothing filed, Dr. Hofer told in the request's thread in Matrix";
    },
  },
  {
    id: "request-1-answer",
    title: "Request 1: Dr. Brandl answers with the requested patient's lab result",
    // In the same session as M3, as Dr. Brandl would after the answer page told her the document is for another patient.
    act: async () => {
      await answer(need(held.r1, "the request 1 link"), need(held.brandl, "Dr. Brandl's session"), DOCS.mariaLab, "filed");
    },
    verify: async (ctx) => {
      const r1 = need(ctx.r1, "request 1");
      await expectState(r1, "filed");
      const filed = await expectEvent(ctx, r1, "answer_filed");
      const refs = filedReferences([filed]);
      if (!refs.length) fail("the answer_filed entry names no FHIR resources");
      return `${refs.length} resources filed`;
    },
  },
  {
    id: "request-2",
    title: "Request 2: Stefan Kern sends the rehab discharge report after an SMS",
    // The link comes from the SMS in the demo SMS outbox, as the SMS screen /sms shows it.
    act: async (ctx) => {
      const sent = await hofer.request.create({ ...KERN, patient: PATIENT_ID });
      ctx.r2 = sent.id;
      if (sent.state !== "sent") fail(`request ${sent.id} is ${sent.state}, expected sent`);
      held.r2 = await tokenFromSms(sent.id);
      const login = await visit(held.r2, CITIZENS.stefan, "answer");
      await answer(held.r2, login.session, DOCS.mariaRehab, "filed");
    },
    verify: async (ctx) => {
      const r2 = need(ctx.r2, "request 2");
      await expectState(r2, "filed");
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
        results.push({ ...base, status: "fail", detail: safeMessage(e) });
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
  // The example entries without the person number the audit log keeps with each outside person's name.
  const printable = (c: RequestCoverage): RequestCoverage => ({
    ...c,
    events: c.events.map((e) => (e.example ? { ...e, example: { ...e.example, actor: who(e.example.actor) } } : e)),
  });
  for (const c of coverage) console.log(coverageLines(printable(c)).join("\n"));
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
// The request emails of this run: kept in this process, never sent (scripts/demo/links.ts).
const inbox = await openTeamInbox();
let results: StepResult[] = [];
let metrics: Metric[] = [];
let validation: Awaited<ReturnType<typeof measure>>["validation"] = null;
try {
  results = await runSteps(ctx);
  console.log("");
  ({ metrics, validation } = await measure(ctx, results));
} finally {
  await inbox.close();
  await db.$client.end();
}

const markdown = metricsMarkdown(metrics, ctx.since);
await mkdir(METRICS_DIR, { recursive: true });
await writeFile(path.join(METRICS_DIR, "scenario.json"), JSON.stringify({ at: ctx.since, requests: { r1: ctx.r1, m1: ctx.m1, r2: ctx.r2 }, steps: results, metrics, validation }, null, 2));
await writeFile(path.join(METRICS_DIR, "metrics.md"), markdown);
console.log(`\n${markdown}\nWritten to ${path.join(METRICS_DIR, "metrics.md")} and scenario.json.`);
process.exit(results.every((r) => r.status === "pass") && metrics.every((m) => m.status === "met") ? 0 : 1);
