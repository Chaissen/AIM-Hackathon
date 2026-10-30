"use client";

import { formatDistanceToNowStrict } from "date-fns";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { lastActivity } from "@/lib/request-story";

import { type ListedRequest, usePatientLookup } from "../data";
import { navigate } from "../use-widget-route";
import { widgetHref } from "../widget-route";
import { StatusBadge } from "./status-badge";

const byActivity = (a: ListedRequest, b: ListedRequest) => lastActivity(b).getTime() - lastActivity(a).getTime() || b.id - a.id;

/**
 * Patient, Document, From, Status, Updated, with the most recent activity first and at most `limit` rows. A click
 * anywhere on a row opens the request; the first column's text is the link for the keyboard. Below 24rem of container
 * width the document sits under the patient; From shows from 42rem and Updated from 36rem. `hidePatient` leaves the
 * patient out, for the list on a patient's own page.
 */
export function RequestTable({ requests, limit, hidePatient = false }: { requests: readonly ListedRequest[]; limit?: number; hidePatient?: boolean }) {
  const patient = usePatientLookup();
  const rows = [...requests].sort(byActivity).slice(0, limit);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{hidePatient ? "Document" : "Patient"}</TableHead>
          {!hidePatient && <TableHead className="hidden @sm/main:table-cell">Document</TableHead>}
          <TableHead className="hidden @2xl/main:table-cell">From</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden text-right @xl/main:table-cell">Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const route = { view: "request", id: r.id } as const;
          const document = DOCUMENT_TYPES[r.docType].label;
          const updated = lastActivity(r);
          return (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(route)}>
              <TableCell className="font-medium whitespace-normal">
                <a href={widgetHref(route)} className="text-loud underline-offset-4 hover:underline">
                  {hidePatient ? document : (patient(r.patientId)?.name ?? r.patientId)}
                </a>
                {!hidePatient && <div className="text-xs font-normal text-muted-foreground @sm/main:hidden">{document}</div>}
              </TableCell>
              {!hidePatient && <TableCell className="hidden whitespace-normal @sm/main:table-cell">{document}</TableCell>}
              <TableCell className="hidden @2xl/main:table-cell">
                <div>
                  {r.given} {r.family}
                </div>
                <div className="text-xs text-muted-foreground">{r.org}</div>
              </TableCell>
              <TableCell>
                <StatusBadge state={r.state} />
              </TableCell>
              <TableCell className="hidden text-right text-muted-foreground @xl/main:table-cell">
                <time dateTime={updated.toISOString()}>{formatDistanceToNowStrict(updated, { addSuffix: true })}</time>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
