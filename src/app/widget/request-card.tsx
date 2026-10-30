"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { EventLabel, OutcomeBadge } from "@/app/audit/audit-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { accepts, linkIsLive, REQUESTER_EVENTS, type RequesterEvent, type RequestState } from "@/server/requests/lifecycle";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

type ListedRequest = RouterOutputs["request"]["list"][number];

const STATE_LABEL: Record<RequestState, string> = {
  awaiting_confirmation: "Needs your confirmation",
  sent: "Sent",
  identity_held: "Identity held",
  verified: "Identity verified",
  answer_held: "Answer held",
  filed: "Answer filed",
  cancelled: "Cancelled",
  expired: "Expired",
  locked: "Link locked",
};

const ACTIONS = {
  send_anyway: { label: "Send anyway", procedure: "sendAnyway", variant: "default", confirm: null },
  accept: { label: "Accept", procedure: "accept", variant: "default", confirm: null },
  reject: { label: "Reject", procedure: "reject", variant: "outline", confirm: null },
  cancel: { label: "Cancel", procedure: "cancel", variant: "outline", confirm: "Click again to cancel" },
} as const satisfies Record<RequesterEvent, { label: string; procedure: string; variant: string; confirm: string | null }>;

const HELD: Partial<Record<RequestState, string>> = {
  identity_held: "The identity check held for the person who signed in. Accept lets that person answer, Reject cancels the request.",
  answer_held: "The answer arrived, but the eHVD could not confirm the sender's role. Reject cancels the request. Filing a held answer on Accept is not built yet.",
};

const CHANNEL_LABEL: Record<ListedRequest["channel"], string> = { email: "Email", sms: "SMS" };

const addressMismatch = z.object({ domain: z.string(), expectedDomain: z.string() });

const formatTime = (at: Date) => at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function useRequests() {
  const trpc = useTRPC();
  return useQuery(trpc.request.list.queryOptions(undefined, { retry: false, refetchInterval: 10_000 }));
}

export function RequestCard({ request }: { request: ListedRequest }) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (event: RequesterEvent) => client.request[ACTIONS[event].procedure].mutate({ id: request.id }),
    // Returned, so the buttons stay disabled until the list shows the new state.
    onSettled: () => queryClient.invalidateQueries(trpc.request.list.pathFilter()),
  });
  const events = REQUESTER_EVENTS.filter((event) => accepts(request.state, event));
  const held = HELD[request.state];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Request {request.id}</CardTitle>
        <CardDescription>{DOCUMENT_TYPES[request.docType].label}</CardDescription>
        <CardAction>
          <Badge variant="secondary">{STATE_LABEL[request.state]}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 [&>dt]:text-muted-foreground">
          <dt>Requested from</dt>
          <dd>
            {request.given} {request.family}, {request.org}
          </dd>
          <dt>{CHANNEL_LABEL[request.channel]}</dt>
          <dd className="break-all">{request.address}</dd>
          <dt>Created</dt>
          <dd>{formatTime(request.createdAt)}</dd>
          {linkIsLive(request.state) && (
            <>
              <dt>Link expires</dt>
              <dd>{formatTime(request.expiresAt)}</dd>
            </>
          )}
        </dl>
        {request.state === "awaiting_confirmation" && <AddressWarning request={request} />}
        {held && <p className="text-muted-foreground">{held}</p>}
        {events.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {events.map((event) => (
              <DecisionButton key={event} event={event} disabled={decide.isPending} onDecide={decide.mutate} />
            ))}
          </div>
        )}
        {decide.error && <p role="alert" className="text-destructive">{decide.error.message}</p>}
        <AuditEntries entries={request.audit} />
      </CardContent>
    </Card>
  );
}

function DecisionButton({ event, disabled, onDecide }: { event: RequesterEvent; disabled: boolean; onDecide: (event: RequesterEvent) => void }) {
  const { label, variant, confirm } = ACTIONS[event];
  const [asking, setAsking] = useState(false);
  return (
    <Button
      size="sm"
      variant={asking ? "destructive" : variant}
      disabled={disabled}
      onBlur={() => setAsking(false)}
      onClick={() => {
        if (confirm && !asking) {
          setAsking(true);
          return;
        }
        setAsking(false);
        onDecide(event);
      }}
    >
      {asking ? confirm : label}
    </Button>
  );
}

function AddressWarning({ request }: { request: ListedRequest }) {
  const entry = request.audit.findLast((a) => a.event === "misdelivery_caught" && a.outcome === "address_mismatch");
  const detail = addressMismatch.safeParse(entry?.detail);
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {detail.success ? (
          <>
            The address domain <code>{detail.data.domain}</code> does not match {request.org} (<code>{detail.data.expectedDomain}</code>).
          </>
        ) : (
          "The address did not pass the address check."
        )}
      </AlertDescription>
    </Alert>
  );
}

function AuditEntries({ entries }: { entries: ListedRequest["audit"] }) {
  return (
    <div className="grid gap-2 border-t pt-3 text-xs">
      <p className="font-medium text-muted-foreground">Audit entries</p>
      <ol className="grid gap-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <time dateTime={e.at.toISOString()} className="text-muted-foreground">
              {formatTime(e.at)}
            </time>
            <span className="font-medium">
              <EventLabel event={e.event} />
            </span>
            <OutcomeBadge entry={e} />
            <span className="break-all text-muted-foreground">{e.actor}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
