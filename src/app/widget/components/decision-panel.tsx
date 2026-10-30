"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import type { RequesterEvent } from "@/server/requests/lifecycle";
import type { IdentityHoldReason, PendingDecision } from "@/server/requests/pending";
import { useTRPC, useTRPCClient } from "@/trpc/react";

import { type ListedRequest, usePatientLookup } from "../data";
import { widgetHref } from "../widget-route";

/** One of Dr. Hofer's decisions as a button: the lifecycle event, the label, and the toast once it went through. */
export type Action = { event: RequesterEvent; label: string; done: string; variant: "default" | "outline"; confirm: string | null };

const PROCEDURE = { send_anyway: "sendAnyway", accept: "accept", reject: "reject", cancel: "cancel" } as const satisfies Record<RequesterEvent, string>;

const PANEL: Record<PendingDecision["kind"], { title: string; actions: readonly [Action, Action] }> = {
  address: {
    title: "The email address looks wrong",
    actions: [
      { event: "send_anyway", label: "Send anyway", done: "Request sent", variant: "default", confirm: null },
      { event: "cancel", label: "Cancel", done: "Request cancelled", variant: "outline", confirm: "Click again to cancel" },
    ],
  },
  identity: {
    title: "Is this the right person?",
    actions: [
      { event: "accept", label: "Accept", done: "Sender accepted", variant: "default", confirm: null },
      { event: "reject", label: "Reject", done: "Sender rejected", variant: "outline", confirm: null },
    ],
  },
  answer: {
    title: "Check this document before it goes into the record",
    actions: [
      { event: "accept", label: "Add to record", done: "Added to the patient record", variant: "default", confirm: null },
      { event: "reject", label: "Reject", done: "Document rejected", variant: "outline", confirm: null },
    ],
  },
};

const HOLD_REASON: Record<IdentityHoldReason, string> = {
  partial_name: "The name matches only in part.",
  requested_name_empty: "The name you entered has no words to compare.",
  ehvd_unreachable: "The eHVD could not be reached to check them.",
  unknown: "The check that held is not in the audit log.",
};

function bodyOf(pending: PendingDecision, org: string): string {
  switch (pending.kind) {
    case "address":
      return pending.mismatch ? `${org} uses @${pending.mismatch.expectedDomain}, but the address is @${pending.mismatch.domain}.` : pending.warning;
    case "identity":
      return `${pending.person ?? "Someone"} logged in with ID Austria. You asked for ${pending.requested}. ${HOLD_REASON[pending.reason]}`;
    case "answer":
      return `${pending.sender} sent a document. ${pending.reason}${pending.filingOpen ? " The last Accept may have filed the answer. Click Accept again." : ""}`;
    default:
      return pending satisfies never;
  }
}

/** Runs one of Dr. Hofer's decisions on a request, then refreshes every request and document query and says so in a toast. */
export function useDecide(requestId: number) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ event }: Action) => client.request[PROCEDURE[event]].mutate({ id: requestId }),
    onSuccess: (_, { done }) => toast.success(done),
    onSettled: () => Promise.all([trpc.request, trpc.document].map((router) => queryClient.invalidateQueries(router.pathFilter()))),
  });
}

type Decide = ReturnType<typeof useDecide>;

/** An action's button. With `confirm`, the first click only asks and the second one acts; leaving the button resets it. */
export function DecideButton({ action, decide, size }: { action: Action; decide: Decide; size?: "sm" | "default" }) {
  const [asking, setAsking] = useState(false);
  return (
    <Button
      size={size}
      variant={asking ? "destructive" : action.variant}
      disabled={decide.isPending}
      onBlur={() => setAsking(false)}
      onClick={() => {
        if (action.confirm && !asking) {
          setAsking(true);
          return;
        }
        setAsking(false);
        decide.mutate(action);
      }}
    >
      {asking ? action.confirm : action.label}
    </Button>
  );
}

/**
 * The decision an open request waits for, with its two buttons. `compact` names the document and the patient in the
 * title and adds a link to the request, for the overview's list.
 */
export function DecisionPanel({ request, compact = false }: { request: ListedRequest; compact?: boolean }) {
  const decide = useDecide(request.id);
  const patient = usePatientLookup();
  const { pending } = request;
  if (!pending) return null;
  const { title, actions } = PANEL[pending.kind];

  return (
    <Alert className="border-warning/30 bg-warning/5">
      <TriangleAlert className="text-warning" />
      <AlertTitle className="text-loud">
        {title}
        {compact && (
          <span className="font-normal text-dim">
            {" · "}
            {DOCUMENT_TYPES[request.docType].label} for {patient(request.patientId)?.name ?? request.patientId}
          </span>
        )}
      </AlertTitle>
      <AlertDescription className="grid gap-3 text-foreground">
        <p>{bodyOf(pending, request.org)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) => (
            <DecideButton key={action.event} action={action} decide={decide} size="sm" />
          ))}
          {compact && (
            <Button asChild size="sm" variant="ghost">
              <a href={widgetHref({ view: "request", id: request.id })}>
                Open <ArrowRight />
              </a>
            </Button>
          )}
        </div>
        {decide.error && (
          <p role="alert" className="text-destructive">
            {decide.error.message}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
