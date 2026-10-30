"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AuditTable } from "@/app/audit/audit-table";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/react";
import { RequestCard, useRequests } from "./request-card";
import { RequestForm } from "./request-form";

function WidgetForm() {
  const trpc = useTRPC();
  const { data, error, isPending } = useQuery(trpc.clinic.patients.queryOptions(undefined, { retry: false }));
  if (error) return <p role="alert">Could not load patients. Check your Element sign-in and the FHIR server, then reload the widget.</p>;
  if (isPending) return <p>Loading patients …</p>;
  return <div className="mx-auto grid w-full max-w-md gap-4"><h1 className="text-lg font-semibold">Request a document</h1><RequestForm patients={data} /></div>;
}

function RequestList() {
  const { data: requests, error, isPending } = useRequests();
  if (error) return <p role="alert">Could not load your requests. Check your Element sign-in and the database, then reload the widget.</p>;
  if (isPending) return <p>Loading requests …</p>;
  if (!requests.length) return <p className="text-sm text-muted-foreground">No requests yet.</p>;
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      {requests.map((r) => (
        <RequestCard key={r.id} request={r} />
      ))}
    </div>
  );
}

const VIEWS = [
  { label: "Request a document", Content: WidgetForm },
  { label: "Requests", Content: RequestList },
  { label: "Audit log", Content: AuditTable },
] as const;

export function ClinicWorkspace() {
  const [view, setView] = useState<(typeof VIEWS)[number]>(VIEWS[0]);
  return (
    <>
      <nav className="flex flex-wrap gap-2" aria-label="Clinic views">
        {VIEWS.map((v) => (
          <Button key={v.label} variant={v === view ? "default" : "outline"} aria-current={v === view ? "page" : undefined} onClick={() => setView(v)}>
            {v.label}
          </Button>
        ))}
      </nav>
      <view.Content />
    </>
  );
}
