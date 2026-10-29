"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { AuditTable } from "@/app/audit/audit-table";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/react";
import { RequestForm } from "./request-form";

export function ClinicWorkspace() {
  const [audit, setAudit] = useState(false);
  return (
    <>
      <nav className="flex gap-2" aria-label="Clinic views">
        <Button variant={!audit ? "default" : "outline"} onClick={() => setAudit(false)}>Request a document</Button>
        <Button variant={audit ? "default" : "outline"} onClick={() => setAudit(true)}>Audit log</Button>
      </nav>
      {audit ? <AuditTable /> : <WidgetForm />}
    </>
  );
}

function WidgetForm() {
  const trpc = useTRPC();
  const { data, error, isPending } = useQuery(trpc.clinic.patients.queryOptions(undefined, { retry: false }));
  if (error) return <p role="alert">Could not load patients. Check your Element sign-in and the FHIR server, then reload the widget.</p>;
  if (isPending) return <p>Loading patients …</p>;
  return <div className="mx-auto grid w-full max-w-md gap-4"><h1 className="text-lg font-semibold">Request a document</h1><RequestForm patients={data} /></div>;
}
