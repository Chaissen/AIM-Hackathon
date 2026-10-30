"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, httpLink, isNonJsonSerializable, loggerLink, splitLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useEffect, useState } from "react";
import superjson from "superjson";

import { WORKSPACE_HEADER } from "@/lib/workspace";
import type { AppRouter } from "@/server/api/root";
import { makeQueryClient } from "./query-client";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

function authenticationLink(onUnauthorized: (() => void) | undefined): TRPCLink<AppRouter> {
  return () => ({ op, next }) => observable((observer) => {
    const subscription = next(op).subscribe({
      next: (value) => observer.next(value),
      error: (error) => {
        if (error.data?.code === "UNAUTHORIZED") onUnauthorized?.();
        observer.error(error);
      },
      complete: () => observer.complete(),
    });
    return () => subscription.unsubscribe();
  });
}

export function TRPCReactProvider({ children, clinicToken, workspace = false, onUnauthorized }: {
  children: React.ReactNode;
  clinicToken?: string;
  workspace?: boolean;
  onUnauthorized?: () => void;
}) {
  const [queryClient] = useState(makeQueryClient);
  useEffect(() => () => queryClient.clear(), [queryClient]);
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        authenticationLink(workspace ? onUnauthorized : undefined),
        loggerLink({ enabled: (op) => !workspace && process.env.NODE_ENV === "development" && typeof window !== "undefined" && op.direction === "down" && op.result instanceof Error }),
        // FormData, such as the answer upload, cannot be batched as JSON and goes in a request of its own.
        splitLink({
          condition: (op) => isNonJsonSerializable(op.input),
          true: httpLink({
            url: "/api/trpc",
            transformer: superjson,
            headers: () => workspace ? { [WORKSPACE_HEADER]: "1" } : {},
          }),
          false: httpBatchLink({
            url: "/api/trpc",
            transformer: superjson,
            headers: () => workspace ? { [WORKSPACE_HEADER]: "1" } : clinicToken ? { Authorization: `Bearer ${clinicToken}` } : {},
          }),
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
