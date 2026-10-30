"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileX2, Mail, MessageSquare } from "lucide-react";
import { useState } from "react";

import { CalendarDate, Time } from "@/components/time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { historyOf, identityAttempts, progressOf, stoppedUploads } from "@/lib/request-story";
import { cn } from "@/lib/utils";
import { accepts, isOpen, linkIsLive } from "@/server/requests/lifecycle";
import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

import { type Action, DecideButton, DecisionPanel, useDecide } from "../components/decision-panel";
import { DocumentView } from "../components/document-view";
import { InlineRetry, LoadError } from "../components/load-error";
import { RequestHistory } from "../components/request-history";
import { RequestProgress } from "../components/request-progress";
import { StatusBadge } from "../components/status-badge";
import { TechnicalDetails } from "../components/technical-details";
import { usePatientLookup } from "../data";
import { type Crumb, ShellPage } from "../shell";
import { widgetHref } from "../widget-route";

type RequestDetail = RouterOutputs["request"]["get"];
type DocumentResult = RouterOutputs["document"]["forRequest"];

const REQUESTS: Crumb = { label: "Requests", route: { view: "requests", filter: "all" } };

const CHANNEL: Record<RequestDetail["channel"], string> = { email: "Email", sms: "SMS" };

const CANCEL_REQUEST: Action = { event: "cancel", label: "Cancel request", done: "Request cancelled", variant: "outline", confirm: "Click again to cancel" };

export function RequestView({ id }: { id: number }) {
  const trpc = useTRPC();
  const request = useQuery(trpc.request.get.queryOptions({ id }, { retry: false, refetchInterval: 10_000 }));

  // Keyed by the id, so moving to another request starts with closed Technical details and a fresh resource choice.
  if (request.data) return <RequestPage key={request.data.id} request={request.data} />;
  return (
    <ShellPage crumbs={[REQUESTS, { label: `Request ${id}` }]}>
      {request.error?.data?.code === "NOT_FOUND" ? (
        <Empty className="border border-dashed border-strong">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileX2 />
            </EmptyMedia>
            <EmptyTitle>Request {id} was not found</EmptyTitle>
            <EmptyDescription>It does not exist, or another member of the clinic sent it.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" size="sm">
              <a href={widgetHref({ view: "requests", filter: "all" })}>Back to Requests</a>
            </Button>
          </EmptyContent>
        </Empty>
      ) : request.error ? (
        <LoadError title={`Could not load request ${id}`} onRetry={() => request.refetch()}>
          Check your Element sign-in and the database, then try again.
        </LoadError>
      ) : (
        <div className="grid gap-6">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      )}
    </ShellPage>
  );
}

function RequestPage({ request }: { request: RequestDetail }) {
  const patient = usePatientLookup()(request.patientId);
  const patientName = patient?.name ?? request.patientId;
  const decide = useDecide(request.id);
  const [technical, setTechnical] = useState(false);
  const docLabel = DOCUMENT_TYPES[request.docType].label;
  const person = `${request.given} ${request.family}`;

  return (
    <ShellPage crumbs={[REQUESTS, { label: `${docLabel} · ${patientName}` }]}>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl">
                {docLabel} for {patientName}
              </h1>
              <StatusBadge state={request.state} />
            </div>
            <p className="text-sm text-dim">
              Asked from {person}, {request.org}, <Time at={request.createdAt} />
            </p>
            {decide.error && (
              <p role="alert" className="text-sm text-destructive">
                {decide.error.message}
              </p>
            )}
          </div>
          {accepts(request.state, "cancel") && <DecideButton action={CANCEL_REQUEST} decide={decide} />}
        </div>

        {request.pending && <DecisionPanel request={request} />}

        <Card size="sm">
          <CardContent>
            <RequestProgress steps={progressOf(request.state, request.audit)} />
          </CardContent>
        </Card>

        <div className="grid items-start gap-6 @4xl/main:grid-cols-[minmax(0,1fr)_20rem]">
          <DocumentCard request={request} person={person} />
          <div className="grid content-start gap-6">
            <Card size="sm">
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <RequestHistory lines={historyOf(request, request.audit)} />
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Patient</dt>
                  <dd>
                    <a href={widgetHref({ view: "patient", id: request.patientId })} className="text-loud underline-offset-4 hover:underline">
                      {patientName}
                    </a>
                    {patient?.birthDate && (
                      <span className="text-muted-foreground">
                        , born <CalendarDate iso={patient.birthDate} />
                      </span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Sent to</dt>
                  <dd className="wrap-anywhere">{request.address}</dd>
                  <dt className="text-muted-foreground">Channel</dt>
                  <dd>{CHANNEL[request.channel]}</dd>
                  {linkIsLive(request.state) && (
                    <>
                      <dt className="text-muted-foreground">Link valid until</dt>
                      <dd>
                        <Time at={request.expiresAt} />
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Requested by</dt>
                  <dd>{request.requesterName}</dd>
                </dl>
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="-ml-2 w-fit">
                      {request.channel === "email" ? <Mail /> : <MessageSquare />} See the message we sent <ChevronDown />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-2 pt-2">
                    <div className="border border-hairline bg-surface-2 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                      {request.message.subject && `${request.message.subject}\n\n`}
                      {request.message.text}
                    </div>
                    <p className="text-xs text-muted-foreground">It names neither the patient nor the document.</p>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          </div>
        </div>

        <Collapsible open={technical} onOpenChange={setTechnical}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-fit text-dim">
              Technical details <ChevronDown className={cn("transition-transform", technical && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-6 pt-3">
            <TechnicalDetails requestId={request.id} docType={request.docType} attempts={identityAttempts(request.audit)} />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </ShellPage>
  );
}

const UNAVAILABLE: Record<Extract<DocumentResult, { status: "unavailable" }>["reason"], string> = {
  fhir_unreachable: "The FHIR server could not be reached. The document is in the record; try again in a moment.",
  not_found: "The filed document was not found on the FHIR server.",
  unreadable: "The document could not be read.",
};

function placeholder(request: RequestDetail, person: string): string {
  if (request.state === "awaiting_confirmation") return "The request goes out once you confirm the address.";
  if (isOpen(request.state)) return `The document appears here once ${person} has sent it.`;
  return "This request is closed. No document arrived.";
}

/**
 * The document by `document.forRequest`, and the note about uploads the patient check stopped. While the request is
 * open an answer can still arrive, so the document is read again every 10 seconds, like the request itself.
 */
function DocumentCard({ request, person }: { request: RequestDetail; person: string }) {
  const trpc = useTRPC();
  const doc = useQuery(trpc.document.forRequest.queryOptions({ id: request.id }, { retry: false, refetchInterval: isOpen(request.state) ? 10_000 : false }));
  const stopped = stoppedUploads(request.audit);
  const shown = doc.data?.status === "held" || doc.data?.status === "filed" ? doc.data : null;

  const body = () => {
    if (doc.error) {
      return (
        <InlineRetry onRetry={() => doc.refetch()}>Could not load the document.</InlineRetry>
      );
    }
    if (doc.isPending) return <Skeleton className="h-40" />;
    switch (doc.data.status) {
      case "none":
        return (
          <Empty className="p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileX2 />
              </EmptyMedia>
              <EmptyDescription>{placeholder(request, person)}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        );
      case "unavailable":
        return (
          <p role="status" className="text-sm text-dim">
            {UNAVAILABLE[doc.data.reason]}
          </p>
        );
      case "held":
      case "filed":
        return <DocumentView doc={doc.data.document} sectionHeading="h3" />;
      default:
        return doc.data satisfies never;
    }
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {/* A heading, so the report's h3 sections nest under it. The classes undo the base h2 style. */}
          <h2 className="font-semibold [font-stretch:inherit]">{shown?.document.title ?? "Document"}</h2>
        </CardTitle>
        {shown?.status === "held" && (
          <CardDescription>
            Sent by {shown.sender}, <Time at={shown.sentAt} />. Not in the record yet.
          </CardDescription>
        )}
        {shown?.status === "filed" && (
          <CardDescription>
            In the patient record since <Time at={shown.filedAt} />.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="gap-4">
        {body()}
        {stopped > 0 && (
          <Alert>
            <FileX2 />
            <AlertTitle>{stopped === 1 ? "A document for another patient was stopped" : `${stopped} documents for another patient were stopped`}</AlertTitle>
            <AlertDescription>Nothing was saved. The sender was asked to upload the right file.</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
