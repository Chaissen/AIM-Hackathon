// Metrics computed from audit rows: audit coverage, effort, and misdeliveries caught (docs/WHITEPAPER.md, "How we measure the metrics").
// Pure functions, so the scripts and the tests share them without a database.
import type { auditLog, requests } from "@/server/db/schema";

export type AuditRow = typeof auditLog.$inferSelect;
export type AuditEventName = AuditRow["event"];
export type MisdeliveryKind = "address_mismatch" | "wrong_person" | "patient_mismatch";

export const TRACK_EVENTS = [
  "request_sent",
  "link_opened",
  "identity_checked",
  "answer_sent",
  "answer_filed",
  "misdelivery_caught",
] as const satisfies readonly AuditEventName[];

type FieldKind = "text" | "number" | "boolean" | "list";
type DetailFields = Record<string, FieldKind>;

// The "What" of each event: the detail fields that `recordAudit()` writes (docs/ARCHITECTURE.md, "Audit log").
export const WHAT: Record<Exclude<AuditEventName, "misdelivery_caught">, DetailFields> = {
  request_sent: { docType: "text", channel: "text", address: "text" },
  link_opened: { state: "text" },
  identity_checked: { checks: "list" },
  answer_sent: { sha256: "text", size: "number" },
  answer_filed: { resources: "list", provenance: "text" },
  request_decided: { from: "text", to: "text" },
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
  const events = TRACK_EVENTS.map((event): EventCoverage => {
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
// written before the patient check, so a rejected upload such as M3 does not stop the clock. Undefined until an answer is filed.
export function effortSpan(rows: AuditRow[], requestId: number): { opened: AuditRow; sent: AuditRow } | undefined {
  const own = rows.filter((r) => r.requestId === requestId).sort(byTime);
  const filed = own.find((r) => r.event === "answer_filed");
  const first = own.find((r) => r.event === "answer_sent");
  if (!filed || !first) return undefined;
  const sent = own.filter((r) => r.event === "answer_sent" && byTime(r, filed) < 0).at(-1);
  const opened = own.filter((r) => r.event === "link_opened" && byTime(r, first) < 0).at(-1);
  return sent && opened ? { opened, sent } : undefined;
}

// The effort in seconds, or null until an answer is filed.
export function effortSeconds(rows: AuditRow[], requestId: number): number | null {
  const span = effortSpan(rows, requestId);
  return span ? (span.sent.at.getTime() - span.opened.at.getTime()) / 1000 : null;
}

// Request 1 of the scenario (track/scenario/README.md): Dr. Brandl's lab result, sent to her own address.
// M1 sends the same request to the mistyped `labor-kanaI.example`, so the address must match exactly.
export const REQUEST_1 = { docType: "lab-result", address: "eva.brandl@labor-kanal.example" } as const;

type RequestRow = Pick<typeof requests.$inferSelect, "id" | "docType" | "address" | "createdAt">;

// The newest request 1, so a timed test measures its own request even after earlier runs.
export function latestRequest1(rows: RequestRow[]): number | undefined {
  const matches = rows.filter((r) => r.docType === REQUEST_1.docType && r.address.trim().toLowerCase() === REQUEST_1.address);
  return matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)[0]?.id;
}

// One request's audit timeline for the timed test (docs/clinical-review/TIMED_TEST_20.md), as `pnpm audit:check --effort`
// prints it. Each entry shows its seconds since the `link_opened` that starts the clock, or since the request's first
// entry while no answer is filed, so the observer can line up hesitations with the log.
export function effortLines(rows: AuditRow[], requestId: number): string[] {
  const own = rows.filter((r) => r.requestId === requestId).sort(byTime);
  if (!own.length) return [`Request ${requestId}: no audit entries`];
  const span = effortSpan(rows, requestId);
  const zero = (span?.opened ?? own[0]).at.getTime();
  const lines = [`Request ${requestId}: seconds since ${span ? "the link_opened that starts the clock" : "the first entry"}`];
  for (const r of own) {
    const offset = ((r.at.getTime() - zero) / 1000).toFixed(1).padStart(7);
    const mark = r === span?.opened ? "  <- start" : r === span?.sent ? "  <- stop" : "";
    lines.push(`  ${r.at.toISOString()}  ${offset} s  ${r.event.padEnd(19)} ${r.outcome.padEnd(17)} ${r.actorKind}${mark}`);
  }
  const seconds = effortSeconds(rows, requestId);
  lines.push(
    seconds === null
      ? "Effort: not measured, because no answer was filed."
      : `Effort: ${Math.round(seconds)} s (${seconds.toFixed(1)} s) from link_opened to the answer_sent that was filed.`,
  );
  return lines;
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
  const lines = [`Request ${c.requestId}: ${c.covered} of ${TRACK_EVENTS.length} event types with who, what, and when`];
  for (const e of c.events) {
    const ex = e.example;
    const entry = ex ? `${ex.at.toISOString()}  ${ex.actor} (${ex.actorKind})  ${ex.outcome}` : "no entry";
    const gap = e.complete > 0 || !ex ? "" : `  missing: ${e.missing.join(", ")}`;
    lines.push(`  ${e.complete > 0 ? "ok  " : "MISS"}  ${e.event.padEnd(19)} ${String(e.entries).padStart(2)}x  ${entry}${gap}`);
  }
  return lines;
}
