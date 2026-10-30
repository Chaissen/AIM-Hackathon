"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleDashed, CircleX, ExternalLink, type LucideIcon } from "lucide-react";

import { Time } from "@/components/time";
import { Badge } from "@/components/ui/badge";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { demoToolsEnabled } from "@/lib/demo-tools";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

import { StatusBadge } from "../components/status-badge";
import { ShellPage } from "../shell";
import { navigate } from "../use-widget-route";
import { widgetHref } from "../widget-route";

// The four hackathon targets, read from the audit log when the view opens (src/server/metrics/live.ts). `pnpm scenario`
// stays the measurement of record, so the view names each number's source and the last runs.

type Overview = RouterOutputs["metrics"]["overview"];
type TargetStatus = Overview["effort"]["status"];
type MisdeliveryTest = Overview["misdeliveries"]["tests"][number];
type ScenarioMetric = NonNullable<Overview["lastScenario"]>["metrics"][number];

type Look = { label: string; variant: "success" | "destructive" | "outline"; icon: LucideIcon };

const TARGET: Record<TargetStatus, Look> = {
  met: { label: "Met", variant: "success", icon: CircleCheck },
  missed: { label: "Missed", variant: "destructive", icon: CircleX },
  not_measured: { label: "Not measured", variant: "outline", icon: CircleDashed },
};

const TEST: Record<MisdeliveryTest["status"], Look> = {
  caught: { label: "Caught", variant: "success", icon: CircleCheck },
  missed: { label: "Missed", variant: "destructive", icon: CircleX },
  not_run: { label: "Not run", variant: "outline", icon: CircleDashed },
};

const TESTS: Record<MisdeliveryTest["id"], { name: string; proves: string }> = {
  M1: { name: "Wrong email address", proves: "A typo in the address is flagged before sending. Whoever opens the link is turned away and sends nothing." },
  M2: { name: "Forwarded to a colleague", proves: "The colleague logs in with their own ID Austria and is turned away." },
  M3: { name: "Document for another patient", proves: "The upload is stopped before filing. Nothing is saved, and the request shows it." },
};

const RUN_STATUS: Record<ScenarioMetric["status"], string> = { met: "met", missed: "missed", blocked: "not measured" };

const mmss = (seconds: number) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};
const plural = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;

/** A stat tile: the value while measured, where it comes from, and how to measure it when it is not. */
type Tile = { label: string; value: string | null; target: string; status: TargetStatus; source: React.ReactNode; howTo: string };

function tilesOf({ validation, effort, misdeliveries, coverage }: Overview): Tile[] {
  const run = validation.lastRun;
  return [
    {
      label: "FHIR validation",
      value: run && plural(run.errors, "error"),
      target: "0 errors",
      status: validation.status,
      source: run && (
        <>
          {run.source} on <Time at={run.at} />, {plural(run.resources, "resource")}
          {validation.filedSince > 0 && `, ${validation.filedSince} outside this run`}
        </>
      ),
      howTo: "Run pnpm validate after a document was filed.",
    },
    {
      label: "Effort for the sender",
      value: effort.seconds === null ? null : mmss(effort.seconds),
      target: "under 2:00, no install, no account",
      status: effort.status,
      source: `Audit log of request ${effort.requestId}, from opening the link to sending the answer that was filed`,
      howTo: "Needs request 1 of the scenario answered and filed: a lab result asked from eva.brandl@labor-kanal.example.",
    },
    {
      label: "Misdeliveries caught",
      value: `${misdeliveries.caught} of ${misdeliveries.tests.length}`,
      target: `${misdeliveries.tests.length} of ${misdeliveries.tests.length}`,
      status: misdeliveries.status,
      source: "Audit log, tests M1 to M3 below",
      howTo: "Run the tests M1 to M3 below, or pnpm scenario.",
    },
    {
      label: "Audit coverage",
      value: `${coverage.covered} of ${coverage.total}`,
      target: `${coverage.total} of ${coverage.total} on request 1`,
      status: coverage.status,
      source: `Audit log of request ${coverage.requestId}: event types with who, what, and when`,
      howTo: "Needs request 1 of the scenario sent.",
    },
  ];
}

export function MetricsView() {
  const trpc = useTRPC();
  const { data, error, isPending } = useQuery(trpc.metrics.overview.queryOptions(undefined, { retry: false, refetchOnMount: "always" }));

  return (
    <ShellPage crumbs={[{ label: "Metrics" }]}>
      <div className="grid gap-8">
        <div className="grid gap-1">
          <h1 className="text-2xl">Metrics</h1>
          <p className="text-sm text-dim">The hackathon targets, read from the audit log when this page opens. pnpm scenario is the measurement of record.</p>
        </div>
        {error ? (
          <p role="alert" className="text-destructive">
            Could not load the metrics. Check your network sign-in and the database, then reload this page.
          </p>
        ) : isPending ? (
          <div className="grid grid-cols-2 gap-3 @3xl/main:grid-cols-4" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : (
          <Loaded overview={data} />
        )}
      </div>
    </ShellPage>
  );
}

function Loaded({ overview }: { overview: Overview }) {
  const run = overview.validation.lastRun;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 @3xl/main:grid-cols-4">
        {tilesOf(overview).map((tile) => (
          <StatTile key={tile.label} tile={tile} />
        ))}
      </div>

      <section className="grid gap-3">
        <h2 className="text-lg">Misdelivery tests</h2>
        <ItemGroup>
          {overview.misdeliveries.tests.map((test) => {
            const look = TEST[test.status];
            return (
              <Item key={test.id} variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {test.id} · {TESTS[test.id].name}
                  </ItemTitle>
                  <ItemDescription>{TESTS[test.id].proves}</ItemDescription>
                  {test.requestId !== null && (
                    <a href={widgetHref({ view: "request", id: test.requestId })} className="w-fit text-xs text-dim underline underline-offset-4 hover:text-loud">
                      Request {test.requestId}
                    </a>
                  )}
                </ItemContent>
                <ItemActions>
                  <Badge variant={look.variant}>
                    <look.icon /> {look.label}
                  </Badge>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      </section>

      {demoToolsEnabled && (
        <section className="grid gap-3">
          <h2 className="text-lg">Try it yourself</h2>
          <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
            <li>
              Open the{" "}
              <a href="/inbox" target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-loud">
                recipient&apos;s inbox <ExternalLink className="size-3" aria-hidden />
              </a>{" "}
              and pick an email or text message.
            </li>
            <li>Open its link as the recipient and log in with the simulated ID Austria.</li>
            <li>
              Send the document, then come back here or open the{" "}
              <a href={widgetHref({ view: "requests", filter: "all" })} className="underline underline-offset-4 hover:text-loud">
                request
              </a>{" "}
              to see it arrive.
            </li>
          </ol>
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="text-lg">Per request</h2>
        {overview.requests.length === 0 ? (
          <p className="text-sm text-dim">No requests yet.</p>
        ) : (
          <div className="min-w-0 border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead className="hidden @md/main:table-cell">Person</TableHead>
                  <TableHead className="hidden @lg/main:table-cell">Effort</TableHead>
                  <TableHead className="hidden @lg/main:table-cell">Coverage</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.requests.map((request) => {
                  const route = { view: "request", id: request.id } as const;
                  return (
                    <TableRow key={request.id} className="cursor-pointer" onClick={() => navigate(route)}>
                      <TableCell>
                        <a href={widgetHref(route)} className="font-medium text-loud" onClick={(event) => event.stopPropagation()}>
                          {request.id}
                        </a>
                      </TableCell>
                      <TableCell className="whitespace-normal">{DOCUMENT_TYPES[request.docType].label}</TableCell>
                      <TableCell className="hidden whitespace-normal @md/main:table-cell">{request.person}</TableCell>
                      <TableCell className="hidden @lg/main:table-cell">{request.effortSeconds === null ? "" : mmss(request.effortSeconds)}</TableCell>
                      <TableCell className="hidden @lg/main:table-cell">
                        {request.covered} of {overview.coverage.total}
                      </TableCell>
                      <TableCell>
                        <StatusBadge state={request.state} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="grid gap-2 border-t border-hairline pt-4 text-xs text-muted-foreground">
        <p className="eyebrow">Last runs</p>
        <p>
          The tiles above read the audit log at <Time at={overview.at} />. pnpm scenario also checks the portal pages and the Matrix notice, which the
          tiles cannot, so its table is the measurement of record.
        </p>
        <p>
          {run ? (
            <>
              {run.source} on <Time at={run.at} /> found {plural(run.errors, "error")} in {plural(run.resources, "resource")}.
            </>
          ) : (
            "No validator run yet."
          )}
          {overview.validation.filedSince > 0 && ` ${plural(overview.validation.filedSince, "resource")} outside this run ${overview.validation.filedSince === 1 ? "needs" : "need"} validation.`}
        </p>
        {overview.lastScenario ? (
          <div className="grid gap-1">
            <p>
              pnpm scenario on <Time at={overview.lastScenario.at} /> measured
            </p>
            <ul className="grid gap-0.5 pl-4">
              {overview.lastScenario.metrics.map((metric) => (
                <li key={metric.name} className="list-disc">
                  {metric.name}, target {metric.target}, result {metric.result}, {RUN_STATUS[metric.status]}.
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>No pnpm scenario run yet.</p>
        )}
      </section>
    </>
  );
}

/** Label, value in the body face with proportional figures, the target, and the source line, with the status as icon and word. */
function StatTile({ tile }: { tile: Tile }) {
  const look = TARGET[tile.status];
  const measured = tile.status !== "not_measured" && tile.value !== null;
  return (
    <div className="grid content-start gap-2 border border-hairline bg-surface p-3 @md/main:p-4">
      <span className="eyebrow">{tile.label}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={cn("font-sans leading-none font-semibold text-loud proportional-nums", measured ? "text-3xl" : "text-base text-dim")}>
          {measured ? tile.value : "No value yet"}
        </span>
        <Badge variant={look.variant}>
          <look.icon /> {look.label}
        </Badge>
      </div>
      <span className="text-xs text-dim">Target {tile.target}</span>
      <span className="text-xs text-muted-foreground">{measured ? tile.source : tile.howTo}</span>
    </div>
  );
}
