"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/react";

const LABELS = { database: "Database", fhir: "FHIR server", matrix: "Matrix" } as const;

export function SystemStatus() {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.health.check.queryOptions(undefined, { refetchInterval: 10_000 }));

  if (isPending) return <p className="mt-6 text-center text-muted-foreground">Checking services …</p>;
  if (error) return <p className="mt-6 text-center text-destructive">tRPC not reachable: {error.message}</p>;

  return (
    <ul className="mt-8 border-y border-border">
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
        <li key={key} className="flex items-baseline gap-3 border-b border-hairline px-1 py-4 last:border-b-0">
          <span className={data[key].ok ? "text-success" : "text-destructive"}>{data[key].ok ? "●" : "○"}</span>
          <span className="shrink-0 font-medium text-loud">{LABELS[key]}</span>
          <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{data[key].detail}</span>
        </li>
      ))}
    </ul>
  );
}
