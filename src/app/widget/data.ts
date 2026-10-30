import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

export type ListedRequest = RouterOutputs["request"]["list"][number];

/** Dr. Hofer's requests, refreshed every 10 seconds so an answer that arrives shows without a reload. */
export function useRequests() {
  const trpc = useTRPC();
  return useQuery(trpc.request.list.queryOptions(undefined, { retry: false, refetchInterval: 10_000 }));
}

export function useMe() {
  const trpc = useTRPC();
  return useQuery(trpc.clinic.me.queryOptions(undefined, { retry: false, staleTime: Infinity }));
}

export function usePatients() {
  const trpc = useTRPC();
  return useQuery(trpc.clinic.patients.queryOptions(undefined, { retry: false }));
}

/** The patients on HAPI by id. Null while they load or when HAPI fails, so callers fall back to the id. */
export function usePatientLookup() {
  const { data } = usePatients();
  return (id: string) => data?.find((p) => p.id === id) ?? null;
}
