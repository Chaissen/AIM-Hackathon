"use client";

import { useQuery } from "@tanstack/react-query";
import type { RouterOutputs } from "@/trpc/types";
import { useTRPC } from "@/trpc/react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AuditRow = RouterOutputs["clinic"]["audit"][number];

const EVENT_LABEL: Record<AuditRow["event"], string> = {
  request_sent: "Request sent",
  link_opened: "Link opened",
  identity_checked: "Identity checked",
  answer_sent: "Answer sent",
  answer_filed: "Answer filed",
  misdelivery_caught: "Misdelivery caught",
  request_decided: "Request decided",
};

export function EventLabel({ event }: { event: AuditRow["event"] }) {
  return EVENT_LABEL[event];
}

export function OutcomeBadge({ entry }: { entry: Pick<AuditRow, "event" | "outcome"> }) {
  return <Badge variant={entry.event === "misdelivery_caught" || entry.outcome === "fail" ? "destructive" : "secondary"}>{entry.outcome}</Badge>;
}

export function AuditTable() {
  const trpc = useTRPC();
  const { data: rows, error, isPending } = useQuery(trpc.clinic.audit.queryOptions(undefined, { retry: false, refetchOnMount: "always" }));
  if (error) return <p role="alert">Could not load the audit log. Check your Element sign-in and the database, then reload the widget.</p>;
  if (isPending) return <p>Loading audit log …</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No entries yet.</p>;

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time (UTC)</TableHead>
            <TableHead>Request</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Who</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">{r.at.toISOString().replace("T", " ").slice(0, 19)}</TableCell>
              <TableCell>{r.requestId ?? ""}</TableCell>
              <TableCell>
                <EventLabel event={r.event} />
              </TableCell>
              <TableCell>
                <div>{r.actor}</div>
                <div className="text-xs text-muted-foreground">{r.actorKind.replace("_", " ")}</div>
              </TableCell>
              <TableCell>
                <OutcomeBadge entry={r} />
              </TableCell>
              <TableCell className="max-w-md font-mono text-xs whitespace-normal break-all text-muted-foreground">
                {JSON.stringify(r.detail)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
