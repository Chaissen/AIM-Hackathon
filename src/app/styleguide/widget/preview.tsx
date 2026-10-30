"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { WidgetApp } from "@/app/widget/app";
import type { AppRouter } from "@/server/api/root";
import { makeQueryClient } from "@/trpc/query-client";
import { TRPCProvider } from "@/trpc/react";

import { type FixtureSet, fixtureLinkFor, parseFixtureSet } from "./fixtures";

/** The widget as Element shows it, with the clinic procedures answered from fixtures instead of the server. */
export function WidgetPreview() {
  const set = parseFixtureSet(useSearchParams().get("fixtures"));
  // Keyed by the set, so switching sets starts from a fresh store and an empty cache.
  return (
    <FixtureClient key={set} set={set}>
      <WidgetApp />
    </FixtureClient>
  );
}

function FixtureClient({ set, children }: { set: FixtureSet; children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(() => createTRPCClient<AppRouter>({ links: [fixtureLinkFor(set)] }));
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
