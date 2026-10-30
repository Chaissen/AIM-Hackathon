"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { countByFilter, FILTERS, inFilter, REQUEST_FILTERS, type RequestFilter } from "@/lib/request-status";

import { LoadError } from "../components/load-error";
import { RequestTable } from "../components/request-table";
import { RequestsEmpty } from "../components/requests-empty";
import { useRequests } from "../data";
import { type Crumb, ShellPage } from "../shell";
import { navigate } from "../use-widget-route";

const isFilter = (value: string): value is RequestFilter => (REQUEST_FILTERS as readonly string[]).includes(value);

/** The filter lives in the hash, so a tab click navigates and the route brings the tab back, also after a reload. */
export function RequestsView({ filter }: { filter: RequestFilter }) {
  const { data, error, isPending, refetch } = useRequests();
  const crumbs: Crumb[] =
    filter === "all" ? [{ label: "Requests" }] : [{ label: "Requests", route: { view: "requests", filter: "all" } }, { label: FILTERS[filter].label }];
  const counts = data ? countByFilter(data.map((r) => r.state)) : null;
  const shown = data?.filter((r) => inFilter(r.state, filter)) ?? [];

  return (
    <ShellPage crumbs={crumbs}>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl">Requests</h1>
          <p className="text-sm text-dim">Every document you asked for, and where it stands.</p>
        </div>
        <Tabs
          value={filter}
          onValueChange={(value) => {
            if (isFilter(value)) navigate({ view: "requests", filter: value });
          }}
        >
          <TabsList
            variant="line"
            className="w-full flex-wrap justify-start gap-x-1 gap-y-2 border-b border-hairline pb-1.5 group-data-horizontal/tabs:h-auto"
          >
            {REQUEST_FILTERS.map((f) => (
              <TabsTrigger key={f} value={f} className="h-8 flex-none">
                {FILTERS[f].label}
                <span className="text-xs text-dim">{counts ? counts[f] : ""}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {error ? (
          <LoadError title="Could not load your requests" onRetry={() => refetch()}>
            Check your network sign-in and the database, then try again.
          </LoadError>
        ) : isPending ? (
          <Skeleton className="h-48" />
        ) : shown.length === 0 ? (
          <RequestsEmpty filter={filter} />
        ) : (
          <div className="border border-border bg-card">
            <RequestTable requests={shown} />
          </div>
        )}
      </div>
    </ShellPage>
  );
}
