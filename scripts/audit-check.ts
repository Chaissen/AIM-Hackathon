// pnpm audit:check [--request <id>]: lists the six audit event types per request, each with who, what, and when
// (docs/WHITEPAPER.md, "How we measure the metrics"). Exits with 1 unless a request has 6 of 6.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { asc } from "drizzle-orm";

import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { TRACK_EVENTS, auditCoverage, bestCoverage, coverageLines, requestCoverage } from "@/server/metrics/audit";
import { METRICS_DIR } from "@/server/metrics/report";

const { values } = parseArgs({ options: { request: { type: "string" } } });
const requestId = values.request === undefined ? undefined : Number(values.request);
if (requestId !== undefined && !Number.isInteger(requestId)) {
  console.error("Usage: pnpm audit:check [--request <id>]");
  process.exit(2);
}

let rows: (typeof auditLog.$inferSelect)[];
try {
  rows = await db.select().from(auditLog).orderBy(asc(auditLog.at), asc(auditLog.id));
} finally {
  await db.$client.end();
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
