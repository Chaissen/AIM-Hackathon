"use client";

import { UserRound } from "lucide-react";

import { CalendarDate } from "@/components/time";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countByFilter, type RequestFilter } from "@/lib/request-status";
import type { RequestState } from "@/server/requests/lifecycle";

import { InlineRetry, LoadError } from "../components/load-error";
import { type ListedRequest, usePatients, useRequests } from "../data";
import { ShellPage } from "../shell";
import { navigate } from "../use-widget-route";
import { widgetHref } from "../widget-route";

/** The caller's requests grouped by patient and counted per filter, so a row reads its Open and Received in one lookup. */
function countsByPatient(requests: readonly ListedRequest[]): Map<string, Record<RequestFilter, number>> {
  const states = new Map<string, RequestState[]>();
  for (const r of requests) states.set(r.patientId, [...(states.get(r.patientId) ?? []), r.state]);
  return new Map([...states].map(([id, s]) => [id, countByFilter(s)]));
}

/** A count cell. Zero is dimmed so the eye lands on the patients with something going on. */
function Count({ value }: { value: number | null }) {
  if (value === null) return null;
  return <span className={value === 0 ? "text-muted-foreground" : undefined}>{value}</span>;
}

/** The patients on HAPI with their open and received requests. A click anywhere on a row opens the patient. */
export function PatientsView() {
  const patients = usePatients();
  const requests = useRequests();
  const counts = requests.data ? countsByPatient(requests.data) : null;
  const count = (id: string, filter: RequestFilter) => (counts ? (counts.get(id)?.[filter] ?? 0) : null);

  return (
    <ShellPage crumbs={[{ label: "Patients" }]}>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl">Patients</h1>
          <p className="text-sm text-dim">The patients in the clinic&apos;s record, and the documents you asked for about them.</p>
        </div>
        {patients.error ? (
          <LoadError title="Could not load the patients" onRetry={() => patients.refetch()}>
            Check your Element sign-in and the FHIR server, then try again.
          </LoadError>
        ) : patients.isPending ? (
          <Skeleton className="h-48" />
        ) : patients.data.length === 0 ? (
          <Empty className="border border-dashed border-strong">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRound />
              </EmptyMedia>
              <EmptyTitle>No patients yet</EmptyTitle>
              <EmptyDescription>The FHIR server has no patients. They appear here once the record holds them.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {requests.error && (
              <InlineRetry onRetry={() => requests.refetch()}>Could not load your requests, so the counts are missing.</InlineRetry>
            )}
            <div className="border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Born</TableHead>
                    <TableHead className="hidden text-right @md/main:table-cell">Open</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patients.data.map((p) => {
                    const route = { view: "patient", id: p.id } as const;
                    return (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(route)}>
                        <TableCell className="font-medium">
                          <a href={widgetHref(route)} className="text-loud underline-offset-4 hover:underline">
                            {p.name}
                          </a>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.birthDate ? <CalendarDate iso={p.birthDate} /> : "Unknown"}</TableCell>
                        <TableCell className="hidden text-right tabular-nums @md/main:table-cell">
                          <Count value={count(p.id, "open")} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Count value={count(p.id, "received")} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </ShellPage>
  );
}
