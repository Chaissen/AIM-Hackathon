"use client";

import { type AuditEventFilter, AuditEventSelect, AuditTable } from "@/app/audit/audit-table";

import { useRequests } from "../data";
import { ShellPage } from "../shell";
import { navigate } from "../use-widget-route";
import { widgetHref } from "../widget-route";

/** The clinic's audit log behind the event filter from the hash. Only the caller's own requests become links. */
export function AuditView({ event }: { event: AuditEventFilter }) {
  const requests = useRequests();
  const own = new Set(requests.data?.map((r) => r.id));

  return (
    <ShellPage crumbs={[{ label: "Audit log" }]}>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl">Audit log</h1>
          <p className="text-sm text-dim">Who did what and when, for every request of the clinic. Document contents are never stored here.</p>
        </div>
        <AuditEventSelect value={event} onChange={(next) => navigate({ view: "audit", event: next })} />
        <AuditTable event={event} requestHref={(id) => (own.has(id) ? widgetHref({ view: "request", id }) : null)} />
      </div>
    </ShellPage>
  );
}
