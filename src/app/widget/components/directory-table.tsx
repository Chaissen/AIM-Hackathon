"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RouterOutputs } from "@/trpc/types";

import { type RequestDraft, useDraft } from "../draft";

// The healthcare directory table of the Contacts view, for the listed entries and for search results alike. Name always
// shows, Status from 28rem of container width, Details from 36rem, and the OID from 48rem. Below those widths their
// content moves under the name, except the OID.

/** The same shape from directory.listed and directory.search (src/server/ehvd/search.ts). */
export type DirectoryEntry = Extract<RouterOutputs["directory"]["listed"], { status: "ok" }>["entries"][number];

/** The New request prefill for an active person: the suggested document type, the name, and the first organisation. */
function draftOf(entry: DirectoryEntry): Partial<RequestDraft> {
  const [org] = entry.memberOf.flatMap((m) => m.name ?? []);
  return {
    ...(entry.suggestedDocType !== null && { docType: entry.suggestedDocType }),
    ...(entry.given !== null && { given: entry.given }),
    family: entry.family,
    ...(org !== undefined && { org }),
  };
}

/** A person's organisations, or their city without one. An organisation's type and city. */
function affiliation(entry: DirectoryEntry): string | null {
  if (entry.kind === "organisation") return [entry.roles.join(", "), entry.city].filter(Boolean).join(" · ") || null;
  return entry.memberOf.map((m) => m.name ?? m.oid).join(", ") || entry.city;
}

/** A person's specialties, or their roles without one. An organisation's mail domain. */
function details(entry: DirectoryEntry): string | null {
  if (entry.kind === "organisation") return entry.mailDomain;
  return (entry.specialisations.length > 0 ? entry.specialisations : entry.roles).join(", ") || null;
}

/** A request goes to an active person outside the network, so never to the signed-in doctor or her colleagues. */
const requestable = (entry: DirectoryEntry) => entry.kind === "person" && entry.active && !entry.inNetwork;

export function DirectoryTable({ entries, label }: { entries: readonly DirectoryEntry[]; label: string }) {
  const { startRequest } = useDraft();
  return (
    <div className="min-w-0 border border-border bg-card">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden @xl/main:table-cell">Details</TableHead>
            <TableHead className="hidden @md/main:table-cell">Status</TableHead>
            <TableHead className="hidden @3xl/main:table-cell">OID</TableHead>
            <TableHead>
              <span className="sr-only">Request</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const sub = affiliation(entry);
            const detail = details(entry);
            const status = entry.active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>;
            return (
              <TableRow key={entry.oid}>
                <TableCell className="wrap-anywhere whitespace-normal">
                  <div className="font-medium text-loud">{entry.name}</div>
                  {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
                  {detail && <div className="text-xs text-muted-foreground @xl/main:hidden">{detail}</div>}
                  <div className="mt-1.5 @md/main:hidden">{status}</div>
                </TableCell>
                <TableCell className="hidden wrap-anywhere whitespace-normal text-muted-foreground @xl/main:table-cell">{detail ?? "–"}</TableCell>
                <TableCell className="hidden @md/main:table-cell">{status}</TableCell>
                <TableCell className="hidden font-mono text-xs text-muted-foreground @3xl/main:table-cell">{entry.oid}</TableCell>
                <TableCell className="text-right">
                  {requestable(entry) && (
                    <Button size="sm" variant="outline" aria-label={`Request from ${entry.name}`} onClick={() => startRequest(draftOf(entry))}>
                      Request
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
