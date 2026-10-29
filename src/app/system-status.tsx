"use client";

import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/react";

const LABELS = { database: "Database", fhir: "FHIR server", matrix: "Matrix" } as const;

export function SystemStatus() {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.health.check.queryOptions(undefined, { refetchInterval: 10_000 }));

  if (isPending) return <p className="mt-3 text-foreground/60">Checking services …</p>;
  if (error) return <p className="mt-3 text-red-600">tRPC not reachable: {error.message}</p>;

  return (
    <ul className="mt-3 divide-y divide-foreground/10 rounded-lg border border-foreground/10">
      {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
        <li key={key} className="flex items-baseline gap-3 px-4 py-3">
          <span className={data[key].ok ? "text-green-600" : "text-red-600"}>{data[key].ok ? "●" : "○"}</span>
          <span className="font-medium">{LABELS[key]}</span>
          <span className="ml-auto truncate font-mono text-xs text-foreground/60">{data[key].detail}</span>
        </li>
      ))}
    </ul>
  );
}
