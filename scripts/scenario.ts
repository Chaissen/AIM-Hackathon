// pnpm scenario [--no-validate]: runs request 1, M1 to M3, and request 2 against the running stack and writes the
// four metric results to out/metrics/ (docs/WHITEPAPER.md, "How we measure the metrics"). Start `pnpm dev` first.
//
// Each step has two parts. `act` drives the flow the way Dr. Hofer and the outside person would. `verify` checks the
// result in the audit log, on HAPI, and in Matrix. A step without `act` is not runnable yet: `needs` names the open
// issues and `todo` says what `act` must do once they land. Only entries written after the start of the run count.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { gte } from "drizzle-orm";

import { env, mxid } from "@/env";
import { createCaller } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { getBotClient, roomAlias, type MatrixEvent } from "@/server/matrix/client";
import {
  AUDIT_EVENTS,
  bestCoverage,
  coverageLines,
  effortSeconds,
  filedReferences,
  misdeliveryCaught,
  requestCoverage,
  type AuditRow,
  type MisdeliveryKind,
} from "@/server/metrics/audit";
import { METRICS_DIR, metricsMarkdown, type Metric } from "@/server/metrics/report";
import { exportResources, runValidator, totalErrors } from "@/server/metrics/validator";

const { values: flags } = parseArgs({ options: { "no-validate": { type: "boolean", default: false } } });

type Ctx = {
  since: Date;
  // Request ids, set by `act`.
  r1?: number;
  m1?: number;
  r2?: number;
  // The misdelivery_caught entry per test, set by `verify`.
  caught: Partial<Record<"M1" | "M2" | "M3", AuditRow>>;
};

type Step = {
  id: string;
  title: string;
  act?: (ctx: Ctx) => Promise<void>;
  needs?: string;
  todo?: string;
  verify: (ctx: Ctx) => Promise<string>;
};

type StepResult = { id: string; title: string; status: "pass" | "fail" | "blocked" | "skipped"; detail: string };

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

// A notice from the bot in Dr. Hofer's room since the start of the run, found by a part of its text.
async function expectNotice(ctx: Ctx, text: string): Promise<string> {
  const bot = await getBotClient();
  const roomId = (await bot.resolveAlias(roomAlias())) ?? fail(`room ${roomAlias()} not found`);
  const res = await bot.request<{ chunk: MatrixEvent[] }>(
    "GET",
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
  );
  const hit = res.chunk.find(
    (e) => e.type === "m.room.message" && e.origin_server_ts >= ctx.since.getTime() && String(e.content.body ?? "").includes(text),
  );
  return hit ? String(hit.content.body) : fail(`no notice containing "${text}" in ${roomAlias()}`);
}

async function reachable(name: string, url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch((e: Error) => fail(`${name} not reachable at ${url}: ${e.message}`));
  if (!res.ok) fail(`${name} answered ${res.status} at ${url}`);
}

const steps: Step[] = [
  {
    id: "preflight",
    title: "The stack is up",
    verify: async () => {
      const h = await createCaller(createContext({ kind: "anonymous" })).health.check();
      for (const [name, c] of Object.entries({ database: h.database, fhir: h.fhir, matrix: h.matrix })) if (!c.ok) fail(`${name}: ${c.detail}`);
      await reachable("ordy", `${env.PUBLIC_URL}/api/healthz`);
      await reachable("Keycloak", env.OIDC_METADATA_URL);
      await reachable("Mailpit", `${env.MAILPIT_API_URL}/api/v1/info`);
      return "Postgres, HAPI, Synapse, ordy, Keycloak, and Mailpit answer";
    },
  },
  {
    id: "request-1",
    title: "Request 1: Dr. Hofer asks Dr. Brandl for the lab result by email",
    needs: "#3 (request.create), #4 (email to Mailpit)",
    todo:
      `Call request.create through createCaller as ${mxid(env.MATRIX_HOFER_USER)} with the request 1 fields from docs/ARCHITECTURE.md ("Widget"). ` +
      "Set ctx.r1 and read the link from the Mailpit message to eva.brandl@labor-kanal.example.",
    verify: async (ctx) => {
      const sent = await expectEvent(ctx, need(ctx.r1, "request 1"), "request_sent");
      return `request ${sent.requestId} sent by ${sent.actor}`;
    },
  },
  {
    id: "m1",
    title: "M1: wrong address, opened by someone else",
    needs: "#11 (address check), #14 or createCaller (Send anyway), #6 (login), #7 (identity check)",
    todo:
      "Send request 1 again to eva.brandl@labor-kanaI.example and set ctx.m1. Expect awaiting_confirmation, then Send anyway. " +
      "Open the link from Mailpit and log in as anna.huber / demo-anna. The page must show neither patient nor document type.",
    verify: async (ctx) => {
      const m1 = need(ctx.m1, "the M1 request");
      ctx.caught.M1 = await expectMisdelivery(ctx, m1, "wrong_person");
      await expectNotFiled(ctx, m1);
      const address = misdeliveryCaught(await rowsSince(ctx), m1, "address_mismatch", ctx.since);
      return `wrong_person logged for ${ctx.caught.M1.actor}${address ? ", address_mismatch logged before sending" : ""}`;
    },
  },
  {
    id: "m2",
    title: "M2: request 1 forwarded to a colleague",
    needs: "#6 (login), #7 (identity check)",
    todo: "Open the request 1 link and log in as thomas.wagner / demo-thomas.",
    verify: async (ctx) => {
      const r1 = need(ctx.r1, "request 1");
      ctx.caught.M2 = await expectMisdelivery(ctx, r1, "wrong_person");
      await expectNotFiled(ctx, r1);
      return `wrong_person logged for ${ctx.caught.M2.actor}`;
    },
  },
  {
    id: "m3",
    title: "M3: Dr. Brandl answers with Max Beispiel's result",
    needs: "#6 (login), #7 (identity check), #13 (answer upload)",
    todo: "Open the request 1 link, log in as eva.brandl / demo-eva, and upload track/scenario/documents/lab-result-max-beispiel.md.",
    verify: async (ctx) => {
      const r1 = need(ctx.r1, "request 1");
      ctx.caught.M3 = await expectMisdelivery(ctx, r1, "patient_mismatch");
      await expectNotFiled(ctx, r1);
      await expectNotice(ctx, "is about a different patient");
      return "patient_mismatch logged, nothing filed, Dr. Hofer told in Matrix";
    },
  },
  {
    id: "request-1-answer",
    title: "Request 1: Dr. Brandl answers with Maria Beispiel's result",
    needs: "#13 (answer upload), #12 (filing)",
    todo: "In the same session as M3, upload track/scenario/documents/lab-result-maria-beispiel.md.",
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
    needs: "#3 (request.create), #4 (SMS outbox), #6 (login), #7 (identity check), #13 (answer upload), #12 (filing)",
    todo:
      "Send request 2 (rehab-report, Stefan Kern, Reha Waldblick, +43 660 000 0101) and set ctx.r2. Read the link from listSms(), " +
      "log in as stefan.kern / demo-stefan, and upload track/scenario/documents/rehab-report-maria-beispiel.md.",
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
    else if (step.needs && !step.act) results.push({ ...base, status: "blocked", detail: `needs ${step.needs}. To do: ${step.todo}` });
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

async function measure(ctx: Ctx, results: StepResult[]): Promise<Metric[]> {
  const ran = (id: string) => ["pass", "fail"].includes(results.find((r) => r.id === id)?.status ?? "");
  const rows = results[0].status === "pass" ? await rowsSince(ctx) : [];
  const metrics: Metric[] = [];

  const refs = filedReferences(rows);
  const validation: Metric = { name: "FHIR validation", target: "0 errors", result: "no filed resources", status: "blocked" };
  if (refs.length && flags["no-validate"]) validation.result = `${refs.length} filed resources, validator skipped (--no-validate)`;
  else if (refs.length) {
    try {
      const files = await exportResources(refs);
      const checked = await runValidator(files, path.join(METRICS_DIR, "validator-output.json"));
      const errors = totalErrors(checked);
      Object.assign(validation, { result: `${errors} errors in ${checked.length} resources`, status: errors === 0 ? "met" : "missed" });
    } catch (e) {
      validation.result = `validator did not run: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
    }
  }
  metrics.push(validation);

  const effort = ctx.r1 === undefined ? null : effortSeconds(rows, ctx.r1);
  metrics.push(
    effort === null
      ? { name: "Effort for the outside person", target: "0 installs, 0 accounts, under 2 minutes", result: "request 1 not answered", status: "blocked" }
      : {
          name: "Effort for the outside person",
          target: "0 installs, 0 accounts, under 2 minutes",
          result: `${Math.round(effort)} s from link_opened to answer_sent (automated run; the stopwatch test is #20)`,
          status: effort < 120 ? "met" : "missed",
        },
  );

  const tests = ["m1", "m2", "m3"].filter(ran);
  const caught = Object.keys(ctx.caught).length;
  metrics.push({
    name: "Misdeliveries caught",
    target: "3 of 3",
    result: tests.length ? `${caught} of 3` : "M1 to M3 not run",
    status: !tests.length ? "blocked" : caught === 3 ? "met" : "missed",
  });

  const coverage = [ctx.r1, ctx.r2].flatMap((id) => (id === undefined ? [] : [requestCoverage(id, rows)]));
  const best = bestCoverage(coverage);
  for (const c of coverage) console.log(coverageLines(c).join("\n"));
  metrics.push({
    name: "Audit coverage",
    target: `${AUDIT_EVENTS.length} of ${AUDIT_EVENTS.length}`,
    result: best ? `${best.covered} of ${AUDIT_EVENTS.length} on request ${best.requestId}` : "no request sent",
    status: !best ? "blocked" : best.covered === AUDIT_EVENTS.length ? "met" : "missed",
  });
  return metrics;
}

const ctx: Ctx = { since: new Date(), caught: {} };
console.log(`pnpm scenario: started ${ctx.since.toISOString()}\n`);
let results: StepResult[] = [];
let metrics: Metric[] = [];
try {
  results = await runSteps(ctx);
  console.log("");
  metrics = await measure(ctx, results);
} finally {
  await db.$client.end();
}

const markdown = metricsMarkdown(metrics, ctx.since);
await mkdir(METRICS_DIR, { recursive: true });
await writeFile(path.join(METRICS_DIR, "scenario.json"), JSON.stringify({ at: ctx.since, ctx, steps: results, metrics }, null, 2));
await writeFile(path.join(METRICS_DIR, "metrics.md"), markdown);
console.log(`\n${markdown}\nWritten to ${path.join(METRICS_DIR, "metrics.md")} and scenario.json.`);
process.exit(results.every((r) => r.status === "pass") && metrics.every((m) => m.status === "met") ? 0 : 1);
