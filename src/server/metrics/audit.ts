// Metrics computed from audit rows: audit coverage, effort, and misdeliveries caught (docs/WHITEPAPER.md, "How we measure the metrics").
// Pure functions, so the scripts and the tests share them without a database.
import { auditEvent, type auditLog } from "@/server/db/schema";

export type AuditRow = typeof auditLog.$inferSelect;
export type AuditEventName = AuditRow["event"];
export type AuditField = "who" | "what" | "when";
export type MisdeliveryKind = "address_mismatch" | "wrong_person" | "patient_mismatch";

export const AUDIT_EVENTS: readonly AuditEventName[] = auditEvent.enumValues;

// Who: the actor and its kind. What: the outcome. When: a valid timestamp.
export function missingFields(row: AuditRow): AuditField[] {
  const missing: AuditField[] = [];
  if (!row.actor?.trim() || !row.actorKind) missing.push("who");
  if (!row.outcome?.trim()) missing.push("what");
  if (!(row.at instanceof Date) || Number.isNaN(row.at.getTime())) missing.push("when");
  return missing;
}

export type EventCoverage = {
  event: AuditEventName;
  entries: number;
  // Entries with who, what, and when.
  complete: number;
  // The first complete entry, or the first entry when none is complete.
  example?: AuditRow;
  // What the example lacks. Empty when the event is covered.
  missing: AuditField[];
};

export type RequestCoverage = {
  requestId: number;
  events: EventCoverage[];
  // Event types with at least one complete entry.
  covered: number;
};

export function requestCoverage(requestId: number, rows: AuditRow[]): RequestCoverage {
  const own = rows.filter((r) => r.requestId === requestId);
  const events = AUDIT_EVENTS.map((event): EventCoverage => {
    const entries = own.filter((r) => r.event === event);
    const complete = entries.filter((r) => missingFields(r).length === 0);
    const example = complete[0] ?? entries[0];
    return {
      event,
      entries: entries.length,
      complete: complete.length,
      example,
      missing: example ? missingFields(example) : ["who", "what", "when"],
    };
  });
  return { requestId, events, covered: events.filter((e) => e.complete > 0).length };
}

// One coverage per request id in the rows, in id order. Rows without a request id belong to no request.
export function auditCoverage(rows: AuditRow[]): RequestCoverage[] {
  const ids = [...new Set(rows.flatMap((r) => (r.requestId === null ? [] : [r.requestId])))].sort((a, b) => a - b);
  return ids.map((id) => requestCoverage(id, rows));
}

// The request with the most covered event types; the lowest id wins a tie.
export function bestCoverage(coverage: RequestCoverage[]): RequestCoverage | undefined {
  return coverage.reduce<RequestCoverage | undefined>((best, c) => (!best || c.covered > best.covered ? c : best), undefined);
}

const byTime = (a: AuditRow, b: AuditRow) => a.at.getTime() - b.at.getTime() || a.id - b.id;

// Effort for the outside person: from the last `link_opened` before the first `answer_sent` to that `answer_sent`.
// Taking the last opening skips earlier openings by someone else, such as the colleague in M2.
export function effortSeconds(rows: AuditRow[], requestId: number): number | null {
  const own = rows.filter((r) => r.requestId === requestId).sort(byTime);
  const sent = own.find((r) => r.event === "answer_sent");
  if (!sent) return null;
  const opened = own.filter((r) => r.event === "link_opened" && byTime(r, sent) < 0).at(-1);
  if (!opened) return null;
  return (sent.at.getTime() - opened.at.getTime()) / 1000;
}

// The kind sits in `outcome`; `detail.kind` is accepted as well.
export function isMisdelivery(row: AuditRow, kind: MisdeliveryKind): boolean {
  return row.event === "misdelivery_caught" && (row.outcome === kind || row.detail?.kind === kind);
}

export function misdeliveryCaught(rows: AuditRow[], requestId: number, kind: MisdeliveryKind, since?: Date): AuditRow | undefined {
  return rows.find((r) => r.requestId === requestId && isMisdelivery(r, kind) && (!since || r.at >= since));
}

// `Observation/123` or `Observation/123/_history/1`, as HAPI returns them in a transaction response.
const REFERENCE = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/[A-Za-z0-9\-.]+)?$/;

// The FHIR resources named in `answer_filed` entries, as `Type/id`, without duplicates.
// The documented shape is `detail.resources` and `detail.provenance`. Any string that looks like a reference counts,
// so a differently named key still works.
export function filedReferences(rows: AuditRow[]): string[] {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      const m = REFERENCE.exec(value.trim());
      if (m) found.add(`${m[1]}/${m[2]}`);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const row of [...rows].sort(byTime)) if (row.event === "answer_filed") walk(row.detail);
  return [...found];
}

// One line per event type, as `pnpm audit:check` and `pnpm scenario` print them.
export function coverageLines(c: RequestCoverage): string[] {
  const lines = [`Request ${c.requestId}: ${c.covered} of ${AUDIT_EVENTS.length} event types with who, what, and when`];
  for (const e of c.events) {
    const ex = e.example;
    const entry = ex ? `${ex.at.toISOString()}  ${ex.actor} (${ex.actorKind})  ${ex.outcome}` : "no entry";
    const gap = e.complete > 0 || !ex ? "" : `  missing: ${e.missing.join(", ")}`;
    lines.push(`  ${e.complete > 0 ? "ok  " : "MISS"}  ${e.event.padEnd(19)} ${String(e.entries).padStart(2)}x  ${entry}${gap}`);
  }
  return lines;
}
