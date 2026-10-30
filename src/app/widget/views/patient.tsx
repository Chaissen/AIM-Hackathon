"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, UserRoundX } from "lucide-react";

import { CalendarDate, Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

import { DocumentView } from "../components/document-view";
import { InlineRetry, LoadError } from "../components/load-error";
import { RequestTable } from "../components/request-table";
import { useRequests } from "../data";
import { useDraft } from "../draft";
import { type Crumb, ShellPage } from "../shell";
import { widgetHref } from "../widget-route";

type Patient = RouterOutputs["clinic"]["patient"];
type PatientDocument = Extract<RouterOutputs["document"]["forPatient"], { status: "ok" }>["documents"][number];

const PATIENTS: Crumb = { label: "Patients", route: { view: "patients" } };

export function PatientView({ id }: { id: string }) {
  const trpc = useTRPC();
  const patient = useQuery(trpc.clinic.patient.queryOptions({ id }, { retry: false }));

  // Keyed by the id, so moving to another patient starts from the top of that patient's page.
  if (patient.data) return <PatientPage key={patient.data.id} patient={patient.data} />;
  return (
    <ShellPage crumbs={[PATIENTS, { label: id }]}>
      {patient.error?.data?.code === "NOT_FOUND" ? (
        <Empty className="border border-dashed border-strong">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRoundX />
            </EmptyMedia>
            <EmptyTitle>Patient not found</EmptyTitle>
            <EmptyDescription>No patient with the id {id} is on the FHIR server.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" size="sm">
              <a href={widgetHref({ view: "patients" })}>Back to Patients</a>
            </Button>
          </EmptyContent>
        </Empty>
      ) : patient.error ? (
        <LoadError title="Could not load the patient" onRetry={() => patient.refetch()}>
          Check your network sign-in and the FHIR server, then try again.
        </LoadError>
      ) : (
        <div className="grid gap-6">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}
    </ShellPage>
  );
}

function PatientPage({ patient }: { patient: Patient }) {
  const { startRequest } = useDraft();
  return (
    <ShellPage crumbs={[PATIENTS, { label: patient.name }]}>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="grid gap-1">
            <h1 className="text-2xl">{patient.name}</h1>
            <p className="text-sm text-dim">
              {patient.birthDate ? (
                <>
                  Born <CalendarDate iso={patient.birthDate} />
                </>
              ) : (
                "Birth date unknown"
              )}
              {patient.address && <> · {patient.address}</>}
            </p>
          </div>
          <Button onClick={() => startRequest({ patient: patient.id })}>
            <Plus /> Request a document
          </Button>
        </div>

        <PatientDocuments patientId={patient.id} />

        <Card size="sm">
          <CardHeader>
            <CardTitle>
              <CardHeading>Requests</CardHeading>
            </CardTitle>
          </CardHeader>
          {/* The table runs edge to edge, so it fits 360px; its cells bring their own padding. */}
          <CardContent className="px-0">
            <PatientRequests patient={patient} />
          </CardContent>
        </Card>
      </div>
    </ShellPage>
  );
}

/** A card title as an h2, so a report's h3 sections nest under it. The classes undo the base h2 style. */
function CardHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-semibold [font-stretch:inherit]">{children}</h2>;
}

/** Stands in for the document cards while they load, fail, or when the record holds none. */
function DocumentsNote({ children }: { children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <CardHeading>Documents</CardHeading>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** The documents filed for the patient on HAPI, newest first, by `document.forPatient`. One card per document. */
function PatientDocuments({ patientId }: { patientId: string }) {
  const trpc = useTRPC();
  const docs = useQuery(trpc.document.forPatient.queryOptions({ patientId }, { retry: false }));

  if (docs.error) {
    return (
      <DocumentsNote>
        <InlineRetry onRetry={() => docs.refetch()}>Could not load the documents.</InlineRetry>
      </DocumentsNote>
    );
  }
  if (docs.isPending) return <Skeleton className="h-40" />;
  switch (docs.data.status) {
    case "unavailable":
      return (
        <DocumentsNote>
          <InlineRetry role="status" onRetry={() => docs.refetch()}>
            The FHIR server could not be reached.
          </InlineRetry>
        </DocumentsNote>
      );
    case "ok":
      return docs.data.documents.length === 0 ? (
        <DocumentsNote>
          <p className="text-sm text-dim">No documents in the record yet. A received answer is filed here.</p>
        </DocumentsNote>
      ) : (
        docs.data.documents.map((d) => <DocumentCard key={d.reference} document={d} />)
      );
    default:
      return docs.data satisfies never;
  }
}

// `date` is the FHIR resource's `issued` or `date`, passed through as the server read it.
function instant(iso: string | null): Date | null {
  if (iso === null) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The person the document names as responsible: the lab's validating physician, or the report's author. */
function responsible(doc: PatientDocument["document"]): string | null {
  if (!doc) return null;
  return (doc.type === "lab-result" ? doc.validatedBy : doc.writtenBy)?.raw ?? null;
}

/**
 * Titled by the document type, with who is responsible for it and when ordy received it. A document ordy did not file
 * shows its own date instead.
 */
function DocumentCard({ document: d }: { document: PatientDocument }) {
  const from = responsible(d.document);
  const dated = d.filedAt ? null : instant(d.date);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <CardHeading>{DOCUMENT_TYPES[d.type].label}</CardHeading>
        </CardTitle>
        {(from || d.filedAt || dated) && (
          <CardDescription>
            {from && `From ${from}`}
            {from && (d.filedAt || dated) && " · "}
            {d.filedAt && (
              <>
                {from ? "received" : "Received"} <Time at={d.filedAt} />
              </>
            )}
            {dated && (
              <>
                {from ? "dated" : "Dated"} <Time at={dated} />
              </>
            )}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {d.document ? (
          <DocumentView doc={d.document} sectionHeading="h3" />
        ) : (
          <p className="text-sm text-dim">ordy cannot show this document. It is in the record as {d.reference}.</p>
        )}
      </CardContent>
    </Card>
  );
}

function PatientRequests({ patient }: { patient: Patient }) {
  const requests = useRequests();

  if (requests.error) {
    return (
      <div className="px-(--card-spacing)">
        <InlineRetry onRetry={() => requests.refetch()}>Could not load your requests.</InlineRetry>
      </div>
    );
  }
  if (requests.isPending) return <Skeleton className="mx-(--card-spacing) h-24" />;
  const own = requests.data.filter((r) => r.patientId === patient.id);
  if (own.length === 0) return <p className="px-(--card-spacing) text-sm text-dim">You have not asked for a document about {patient.name} yet.</p>;
  return <RequestTable requests={own} hidePatient />;
}
