// pnpm audit:check [--request <id>]: lists the six audit event types per request, each with who, what, and when
// (docs/WHITEPAPER.md, "How we measure the metrics"). Exits with 1 unless a request has 6 of 6.
// pnpm audit:check --effort [--request <id>]: prints the audit timeline and the effort in seconds of the newest request 1,
// or of the given request, for the timed test (docs/clinical-review/TIMED_TEST_20.md). Exits with 1 unless it is under 2 minutes.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { asc } from "drizzle-orm";

import { db } from "@/server/db";
import { auditLog, requests } from "@/server/db/schema";
import {
  auditCoverage,
  bestCoverage,
  coverageLines,
  effortLines,
  effortSeconds,
  latestRequest1,
  REQUEST_1,
  requestCoverage,
  TRACK_EVENTS,
} from "@/server/metrics/audit";
import { effortMetric, METRICS_DIR } from "@/server/metrics/report";

const { values } = parseArgs({ options: { request: { type: "string" }, effort: { type: "boolean", default: false } } });
const requestId = values.request === undefined ? undefined : Number(values.request);
if (requestId !== undefined && !Number.isInteger(requestId)) {
  console.error("Usage: pnpm audit:check [--effort] [--request <id>]");
  process.exit(2);
}

let rows: (typeof auditLog.$inferSelect)[];
let requestRows: Pick<typeof requests.$inferSelect, "id" | "docType" | "address" | "createdAt">[] = [];
try {
  rows = await db.select().from(auditLog).orderBy(asc(auditLog.at), asc(auditLog.id));
  if (values.effort && requestId === undefined) {
    requestRows = await db
      .select({ id: requests.id, docType: requests.docType, address: requests.address, createdAt: requests.createdAt })
      .from(requests);
  }
} finally {
  await db.$client.end();
}

if (values.effort) {
  const id = requestId ?? latestRequest1(requestRows);
  if (id === undefined) {
    console.error(`No request 1 yet: no ${REQUEST_1.docType} request to ${REQUEST_1.address}.`);
    process.exit(1);
  }
  console.log(effortLines(rows, id).join("\n"));
  const metric = effortMetric(effortSeconds(rows, id));
  console.log(`\nTarget under 2 minutes: ${metric.status === "blocked" ? "not measured" : metric.status}.`);
  process.exit(metric.status === "met" ? 0 : 1);
}

const coverage = requestId === undefined ? auditCoverage(rows) : [requestCoverage(requestId, rows)];
if (!coverage.length) {
  console.error("The audit log has no entries for a request yet.");
  process.exit(1);
}
for (const c of coverage) console.log(["", ...coverageLines(c)].join("\n"));

const best = bestCoverage(coverage)!;
await mkdir(METRICS_DIR, { recursive: true });
await writeFile(path.join(METRICS_DIR, "audit.json"), JSON.stringify({ at: new Date(), best: best.requestId, coverage }, null, 2));
console.log(`\nAudit coverage: ${best.covered} of ${TRACK_EVENTS.length} on request ${best.requestId} (target 6 of 6).`);
process.exit(best.covered === TRACK_EVENTS.length ? 0 : 1);
