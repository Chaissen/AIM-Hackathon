// Metrics computed from audit rows: audit coverage, effort, and misdeliveries caught (docs/WHITEPAPER.md, "How we measure the metrics").
// Pure functions, so the scripts and the tests share them without a database.
import { auditEvent, type auditLog } from "@/server/db/schema";

export type AuditRow = typeof auditLog.$inferSelect;
export type AuditEventName = AuditRow["event"];
export type MisdeliveryKind = "address_mismatch" | "wrong_person" | "patient_mismatch";

export const AUDIT_EVENTS: readonly AuditEventName[] = auditEvent.enumValues;

type FieldKind = "text" | "number" | "boolean" | "list";
type DetailFields = Record<string, FieldKind>;

// The "What" of each event: the detail fields that `recordAudit()` writes (docs/ARCHITECTURE.md, "Audit log").
export const WHAT: Record<Exclude<AuditEventName, "misdelivery_caught">, DetailFields> = {
  request_sent: { docType: "text", channel: "text", address: "text" },
  link_opened: { state: "text" },
  identity_checked: { checks: "list" },
  answer_sent: { sha256: "text", size: "number" },
  answer_filed: { resources: "list", provenance: "text" },
};
// A misdelivery names its kind in `outcome`, and the detail fields depend on the kind.
export const MISDELIVERY_WHAT: Record<MisdeliveryKind, DetailFields> = {
  address_mismatch: { domain: "text", expectedDomain: "text" },
  wrong_person: { checks: "list" },
  patient_mismatch: { sha256: "text", size: "number", nameMatches: "boolean", birthDateMatches: "boolean" },
};

const hasKind = (value: unknown, kind: FieldKind) =>
  kind === "text"
    ? typeof value === "string" && value.trim() !== ""
    : kind === "number"
      ? typeof value === "number" && Number.isFinite(value)
      : kind === "boolean"
        ? typeof value === "boolean"
        : Array.isArray(value) && value.length > 0;

// What an entry lacks: `who` (actor and its kind), `when` (a valid timestamp), `outcome`, or a `detail.<field>` of its "What".
export function missingFields(row: AuditRow): string[] {
  const missing: string[] = [];
  if (!row.actor?.trim() || !row.actorKind) missing.push("who");
  if (!(row.at instanceof Date) || Number.isNaN(row.at.getTime())) missing.push("when");
  if (!row.outcome?.trim()) missing.push("outcome");
  const fields =
    row.event === "misdelivery_caught" ? MISDELIVERY_WHAT[row.outcome as MisdeliveryKind] : WHAT[row.event as keyof typeof WHAT];
  if (!fields) {
    if (row.outcome?.trim()) missing.push("outcome");
    return missing;
  }
  const detail = row.detail ?? {};
  for (const [field, kind] of Object.entries(fields)) if (!hasKind(detail[field], kind)) missing.push(`detail.${field}`);
  return missing;
}

export type EventCoverage = {
  event: AuditEventName;
  entries: number;
  // Entries with who, what (the outcome and the detail fields), and when.
  complete: number;
  // The first complete entry, or the first entry when none is complete.
  example?: AuditRow;
  // What the example lacks. Empty when the event is covered.
  missing: string[];
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
      missing: example ? missingFields(example) : [],
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

// Effort for the outside person: from opening the link to sending the answer that was filed.
// The start is the last `link_opened` before the first `answer_sent`, which skips earlier openings by someone else,
// such as the colleague in M2. The end is the last `answer_sent` before the first `answer_filed`: `answer_sent` is
// written before the patient check, so a rejected upload such as M3 does not stop the clock. Null until an answer is filed.
export function effortSeconds(rows: AuditRow[], requestId: number): number | null {
  const own = rows.filter((r) => r.requestId === requestId).sort(byTime);
  const filed = own.find((r) => r.event === "answer_filed");
  const first = own.find((r) => r.event === "answer_sent");
  if (!filed || !first) return null;
  const sent = own.filter((r) => r.event === "answer_sent" && byTime(r, filed) < 0).at(-1);
  const opened = own.filter((r) => r.event === "link_opened" && byTime(r, first) < 0).at(-1);
  if (!sent || !opened) return null;
  return (sent.at.getTime() - opened.at.getTime()) / 1000;
}

// The kind sits in `outcome`, as `recordAudit()` writes it.
export function isMisdelivery(row: AuditRow, kind: MisdeliveryKind): boolean {
  return row.event === "misdelivery_caught" && row.outcome === kind;
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
