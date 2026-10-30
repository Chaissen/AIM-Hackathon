"use client";

import { ArrowRight, Clock, Inbox, type LucideIcon, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { countByFilter, type RequestFilter } from "@/lib/request-status";
import { cn } from "@/lib/utils";

import { DecisionPanel } from "../components/decision-panel";
import { LoadError } from "../components/load-error";
import { RequestTable } from "../components/request-table";
import { RequestsEmpty } from "../components/requests-empty";
import { useMe, useRequests } from "../data";
import { ShellPage } from "../shell";
import { widgetHref } from "../widget-route";

/** `short` is the label below 28rem of container width, where three tiles share one row. */
type Tile = { label: string; short: string; icon: LucideIcon; filter: RequestFilter; value: number; warn: boolean };

export function OverviewView() {
  const me = useMe();
  const requests = useRequests();
  const counts = requests.data ? countByFilter(requests.data.map((r) => r.state)) : null;
  const tiles: Tile[] | null = counts && [
    { label: "Waiting for a reply", short: "Waiting", icon: Clock, filter: "open", value: counts.open - counts.attention, warn: false },
    { label: "Needs your attention", short: "Needs you", icon: TriangleAlert, filter: "attention", value: counts.attention, warn: counts.attention > 0 },
    { label: "Received", short: "Received", icon: Inbox, filter: "received", value: counts.received, warn: false },
  ];
  const attention = requests.data?.filter((r) => r.pending !== null) ?? [];

  return (
    <ShellPage crumbs={[{ label: "Overview" }]}>
      <div className="grid gap-6">
        <div className="grid gap-1">
          <h1 className="text-2xl">Good day{me.data ? `, ${me.data.displayName}` : ""}</h1>
          <p className="text-sm text-dim">Documents you asked for from labs, rehab clinics, and other practices.</p>
        </div>

        {requests.error ? (
          <LoadError title="Could not load your requests" onRetry={() => requests.refetch()}>
            Check your Element sign-in and the database, then try again.
          </LoadError>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {tiles
                ? tiles.map((tile) => (
                    <a
                      key={tile.filter}
                      href={widgetHref({ view: "requests", filter: tile.filter })}
                      className="grid content-between gap-2 border border-hairline bg-surface p-3 transition-colors hover:border-strong hover:bg-surface-2 @md/main:p-4"
                    >
                      <span className="eyebrow flex items-center gap-1.5">
                        <tile.icon className="size-3.5 shrink-0" aria-hidden />
                        <span className="@md/main:hidden">{tile.short}</span>
                        <span className="hidden @md/main:inline">{tile.label}</span>
                      </span>
                      <span className={cn("font-heading text-2xl @md/main:text-3xl", tile.warn ? "text-warning" : "text-loud")}>{tile.value}</span>
                    </a>
                  ))
                : [0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}
            </div>

            {attention.length > 0 && (
              <section className="grid gap-3" aria-labelledby="attention">
                <h2 id="attention" className="text-base">
                  Needs your attention
                </h2>
                {attention.map((r) => (
                  <DecisionPanel key={r.id} request={r} compact />
                ))}
              </section>
            )}

            <section className="grid gap-3" aria-labelledby="recent">
              <div className="flex items-center justify-between gap-2">
                <h2 id="recent" className="text-base">
                  Recent requests
                </h2>
                <Button asChild variant="ghost" size="sm">
                  <a href={widgetHref({ view: "requests", filter: "all" })}>
                    View all <ArrowRight />
                  </a>
                </Button>
              </div>
              {requests.isPending ? (
                <Skeleton className="h-40" />
              ) : requests.data.length === 0 ? (
                <RequestsEmpty filter="all" />
              ) : (
                <div className="border border-border bg-card">
                  <RequestTable requests={requests.data} limit={5} />
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </ShellPage>
  );
}
