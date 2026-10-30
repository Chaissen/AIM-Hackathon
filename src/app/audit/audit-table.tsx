"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleMinus, CircleX, type LucideIcon } from "lucide-react";
import { z } from "zod";

import { AUDIT_EVENTS } from "@/app/widget/widget-route";
import { EventTime } from "@/components/time";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { outsidePersonName } from "@/lib/audit-actor";
import { DOCUMENT_TYPES, documentTypeKeys } from "@/lib/document-types";
import { CHECK_LABEL, checkText } from "@/lib/identity-check-text";
import { STATUS, type Status } from "@/lib/request-status";
import type { Tone } from "@/lib/request-story";
import { cn } from "@/lib/utils";
import type { CheckResult } from "@/server/identity/checks";
import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

// The audit log as Dr. Hofer reads it, in the widget's Audit log view and on /audit. The outcome's tone comes from one
// lookup, and the detail jsonb is parsed into labelled pairs at this boundary.

type AuditRow = RouterOutputs["clinic"]["audit"][number];
export type AuditEvent = AuditRow["event"];
export type AuditEventFilter = AuditEvent | "all";

const EVENT_LABEL: Record<AuditEvent, string> = {
  request_sent: "Request sent",
  link_opened: "Link opened",
  identity_checked: "Identity checked",
  answer_sent: "Answer sent",
  answer_filed: "Answer filed",
  misdelivery_caught: "Misdelivery caught",
  request_decided: "Request decided",
};

const ACTOR_KIND: Record<AuditRow["actorKind"], string> = {
  network_member: "network member",
  outside_person: "outside person",
  anonymous: "anonymous",
  service: "service",
};

const TONE: Record<Tone, { variant: "success" | "warning" | "destructive" | "outline"; text: string; icon: LucideIcon }> = {
  pass: { variant: "success", text: "text-success", icon: CircleCheck },
  hold: { variant: "warning", text: "text-warning", icon: CircleAlert },
  fail: { variant: "destructive", text: "text-destructive", icon: CircleX },
  none: { variant: "outline", text: "text-muted-foreground", icon: CircleMinus },
};
// `outcome` is free text in the schema; the writers in src/server/audit/record.ts use these values.
const OUTCOME_TONE: Partial<Record<string, Tone>> = { sent: "pass", pass: "pass", filed: "pass", accepted: "pass", hold: "hold", fail: "fail", refused: "fail" };

/** A misdelivery is a fail whatever its kind; every other entry is judged by its outcome. */
function toneOf(entry: Pick<AuditRow, "event" | "outcome">): Tone {
  return entry.event === "misdelivery_caught" ? "fail" : (OUTCOME_TONE[entry.outcome] ?? "none");
}

type DetailPair = { label: string; value: string; mono: boolean };

const CHECKS: { [C in CheckResult["check"]]: C } = {
  level: "level",
  name: "name",
  person_number: "person_number",
  ehvd_claim: "ehvd_claim",
  request_person: "request_person",
  service: "service",
};
const checkList = z.array(z.object({ check: z.enum(CHECKS), result: z.enum(["pass", "hold", "fail"]), reason: z.string() }));
const documentTypeKey = z.enum(documentTypeKeys);
const stateLabel: Partial<Record<string, Status>> = STATUS;

const formatBytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`);

function asState(raw: unknown, label: string): DetailPair[] | null {
  const status = typeof raw === "string" ? stateLabel[raw] : undefined;
  return status ? [{ label, value: status.label, mono: false }] : null;
}

type Field = { label: string; mono?: boolean; pairs?: (raw: unknown, label: string) => DetailPair[] | null };

// The detail keys the writers use (src/server/audit/record.ts and src/server/fhir/file-answer.ts). An unknown key shows as it is.
const FIELDS: Partial<Record<string, Field>> = {
  docType: {
    label: "Document type",
    pairs: (raw, label) => {
      const parsed = documentTypeKey.safeParse(raw);
      return parsed.success ? [{ label, value: DOCUMENT_TYPES[parsed.data].label, mono: false }] : null;
    },
  },
  channel: { label: "Channel" },
  address: { label: "Address", mono: true },
  sentAnyway: { label: "Sent anyway" },
  state: { label: "Link state", pairs: asState },
  checks: {
    label: "Checks",
    pairs: (raw) => {
      const parsed = checkList.safeParse(raw);
      return parsed.success ? parsed.data.map((c) => ({ label: CHECK_LABEL[c.check], value: `${checkText(c)} (${c.result})`, mono: false })) : null;
    },
  },
  sha256: { label: "SHA-256", mono: true },
  size: { label: "Size", pairs: (raw, label) => (typeof raw === "number" ? [{ label, value: formatBytes(raw), mono: false }] : null) },
  nameMatches: { label: "Name matches" },
  birthDateMatches: { label: "Birth date matches" },
  resources: { label: "Resources", mono: true },
  provenance: { label: "Provenance", mono: true },
  output: { label: "Output", mono: true },
  targets: { label: "Targets", mono: true },
  task: { label: "Task", mono: true },
  sender: { label: "Sender", mono: true },
  author: { label: "Author", mono: true },
  organization: { label: "Organisation", mono: true },
  acceptedBy: { label: "Accepted by", mono: true },
  from: { label: "From", pairs: asState },
  to: { label: "To", pairs: asState },
  domain: { label: "Domain", mono: true },
  expectedDomain: { label: "Expected domain", mono: true },
};

function text(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "boolean") return raw ? "yes" : "no";
  if (typeof raw === "number") return String(raw);
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) return raw.join(", ");
  return JSON.stringify(raw);
}

/**
 * One labelled pair per detail field, with a list of identity checks spread into one sentence per check. Each pair is
 * keyed by its field and its label, which the checks of one entry never repeat.
 */
function detailPairs(detail: AuditRow["detail"]): (DetailPair & { key: string })[] {
  return Object.entries(detail).flatMap(([key, raw]) => {
    const field = FIELDS[key] ?? { label: key };
    const pairs = field.pairs?.(raw, field.label) ?? [{ label: field.label, value: text(raw), mono: field.mono ?? false }];
    return pairs.map((pair) => ({ ...pair, key: `${key} ${pair.label}` }));
  });
}

export function EventLabel({ event }: { event: AuditEvent }) {
  return <>{EVENT_LABEL[event]}</>;
}

export function OutcomeBadge({ entry }: { entry: Pick<AuditRow, "event" | "outcome"> }) {
  return <Badge variant={TONE[toneOf(entry)].variant}>{entry.outcome.replaceAll("_", " ")}</Badge>;
}

const eventFilter = z.union([z.enum(AUDIT_EVENTS), z.literal("all")]);

export function AuditEventSelect({ value, onChange }: { value: AuditEventFilter; onChange: (event: AuditEventFilter) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(eventFilter.parse(next))}>
      <SelectTrigger size="sm" aria-label="Show events" className="w-full max-w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All events</SelectItem>
        {Object.values(AUDIT_EVENTS).map((event) => (
          <SelectItem key={event} value={event}>
            {EVENT_LABEL[event]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Every entry, newest first, filtered by `event`. `requestHref` turns a request id into a link; without one, or when it
 * answers null, the id shows as text. The table is its own container, so the Outcome, Who, and Details columns fold
 * into the Event cell by the width the table really has, on /audit as in the widget.
 */
export function AuditTable({ event = "all", requestHref }: { event?: AuditEventFilter; requestHref?: (requestId: number) => string | null }) {
  const trpc = useTRPC();
  const { data, error, isPending } = useQuery(trpc.clinic.audit.queryOptions(undefined, { retry: false, refetchOnMount: "always" }));
  if (error) {
    return (
      <p role="alert" className="text-destructive">
        Could not load the audit log. Check your Element sign-in and the database, then reload the widget.
      </p>
    );
  }
  if (isPending) {
    return (
      <div className="grid gap-2" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  const rows = event === "all" ? data : data.filter((r) => r.event === event);
  if (rows.length === 0) {
    return <p className="text-sm text-dim">{event === "all" ? "No entries yet." : `No "${EVENT_LABEL[event]}" entries yet.`}</p>;
  }

  return (
    <div className="@container min-w-0 border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Event</TableHead>
            <TableHead className="hidden @2xl:table-cell">Who</TableHead>
            <TableHead className="hidden @md:table-cell">Outcome</TableHead>
            <TableHead className="hidden @4xl:table-cell">Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <AuditEntry key={row.id} row={row} href={row.requestId === null ? null : (requestHref?.(row.requestId) ?? null)} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AuditEntry({ row, href }: { row: AuditRow; href: string | null }) {
  const tone = TONE[toneOf(row)];
  const pairs = detailPairs(row.detail);
  return (
    <TableRow>
      <TableCell className="align-top text-dim">
        <EventTime at={row.at} />
      </TableCell>
      <TableCell className="min-w-44 align-top whitespace-normal">
        <div className="flex items-center gap-1.5 text-loud">
          <tone.icon className={cn("size-4 shrink-0", tone.text)} aria-hidden />
          {EVENT_LABEL[row.event]}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {row.requestId !== null &&
            (href ? (
              <a href={href} className="text-xs text-dim underline underline-offset-4 hover:text-loud">
                Request {row.requestId}
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">Request {row.requestId}</span>
            ))}
          <span className="@md:hidden">
            <OutcomeBadge entry={row} />
          </span>
        </div>
        <div className="mt-1.5 @2xl:hidden">
          <Who row={row} />
        </div>
        <div className="mt-1.5 @4xl:hidden">
          <Details pairs={pairs} />
        </div>
      </TableCell>
      <TableCell className="hidden max-w-56 align-top whitespace-normal @2xl:table-cell">
        <Who row={row} />
      </TableCell>
      <TableCell className="hidden align-top @md:table-cell">
        <OutcomeBadge entry={row} />
      </TableCell>
      <TableCell className="hidden max-w-md align-top whitespace-normal @4xl:table-cell">
        <Details pairs={pairs} />
      </TableCell>
    </TableRow>
  );
}

function Who({ row }: { row: AuditRow }) {
  return (
    <div className="grid min-w-0 text-sm">
      <span className="wrap-anywhere">{outsidePersonName(row.actor) ?? row.actor}</span>
      <span className="text-xs text-muted-foreground">{ACTOR_KIND[row.actorKind]}</span>
    </div>
  );
}

/** Label and value per line; in the wide Details column the pairs line up in two columns. */
function Details({ pairs }: { pairs: ReturnType<typeof detailPairs> }) {
  if (pairs.length === 0) return null;
  return (
    <dl className="grid gap-y-1 text-xs @4xl:grid-cols-[max-content_minmax(0,1fr)] @4xl:gap-x-3 @4xl:gap-y-0.5">
      {pairs.map((pair) => (
        <div key={pair.key} className="flex flex-wrap gap-x-2 @4xl:contents">
          <dt className="text-muted-foreground">{pair.label}</dt>
          <dd className={cn("min-w-0 wrap-anywhere text-dim", pair.mono && "font-mono")}>{pair.value}</dd>
        </div>
      ))}
    </dl>
  );
}
