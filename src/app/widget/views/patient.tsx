"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, UserRoundX } from "lucide-react";

import { CalendarDate, Time } from "@/components/time";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
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

  // Keyed by the id, so moving to another patient starts with that patient's newest document open.
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

        <section className="grid gap-3" aria-labelledby="documents">
          <h2 id="documents" className="text-base">
            Documents in the record
          </h2>
          <PatientDocuments patientId={patient.id} />
        </section>

        <section className="grid gap-3" aria-labelledby="requests">
          <h2 id="requests" className="text-base">
            Requests
          </h2>
          <PatientRequests patient={patient} />
        </section>
      </div>
    </ShellPage>
  );
}

/** The documents filed for the patient on HAPI, newest first, by `document.forPatient`. */
function PatientDocuments({ patientId }: { patientId: string }) {
  const trpc = useTRPC();
  const docs = useQuery(trpc.document.forPatient.queryOptions({ patientId }, { retry: false }));

  if (docs.error) {
    return (
      <InlineRetry onRetry={() => docs.refetch()}>Could not load the documents.</InlineRetry>
    );
  }
  if (docs.isPending) return <Skeleton className="h-24" />;
  switch (docs.data.status) {
    case "unavailable":
      return (
        <InlineRetry role="status" onRetry={() => docs.refetch()}>
          The FHIR server could not be reached.
        </InlineRetry>
      );
    case "ok":
      return docs.data.documents.length === 0 ? (
        <p className="text-sm text-dim">No documents in the record yet. A received answer is filed here.</p>
      ) : (
        <DocumentList documents={docs.data.documents} />
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

/** One accordion item per document, the newest open. The content undoes the accordion's prose styling for the document. */
function DocumentList({ documents }: { documents: readonly PatientDocument[] }) {
  return (
    <Accordion type="multiple" defaultValue={documents.slice(0, 1).map((d) => d.reference)}>
      {documents.map((d) => {
        const at = instant(d.date);
        return (
          <AccordionItem key={d.reference} value={d.reference}>
            <AccordionTrigger className="py-4">
              <span className="grid gap-0.5">
                <span>{d.title}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {DOCUMENT_TYPES[d.type].label}
                  {at && (
                    <>
                      {" · "}
                      <Time at={at} />
                    </>
                  )}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-foreground [&_p:not(:last-child)]:mb-0">
              {d.document ? (
                <DocumentView doc={d.document} sectionHeading="h4" />
              ) : (
                <p className="text-sm text-dim">ordy cannot show this document. It is in the record as {d.reference}.</p>
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function PatientRequests({ patient }: { patient: Patient }) {
  const requests = useRequests();

  if (requests.error) {
    return (
      <LoadError title="Could not load your requests" onRetry={() => requests.refetch()}>
        Check your network sign-in and the database, then try again.
      </LoadError>
    );
  }
  if (requests.isPending) return <Skeleton className="h-24" />;
  const own = requests.data.filter((r) => r.patientId === patient.id);
  if (own.length === 0) return <p className="text-sm text-dim">You have not asked for a document about {patient.name} yet.</p>;
  return (
    <div className="border border-border bg-card">
      <RequestTable requests={own} hidePatient />
    </div>
  );
}
