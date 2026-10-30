"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, httpLink, isNonJsonSerializable, loggerLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import superjson from "superjson";

import type { AppRouter } from "@/server/api/root";
import { makeQueryClient } from "./query-client";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

// ClinicAccess remounts this provider when credentials change, discarding the previous identity's cache.
export function TRPCReactProvider({ children, clinicToken }: { children: React.ReactNode; clinicToken?: string }) {
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({ enabled: (op) => process.env.NODE_ENV === "development" && typeof window !== "undefined" && op.direction === "down" && op.result instanceof Error }),
        // FormData, such as the answer upload, cannot be batched as JSON and goes in a request of its own.
        splitLink({
          condition: (op) => isNonJsonSerializable(op.input),
          true: httpLink({ url: "/api/trpc", transformer: superjson }),
          false: httpBatchLink({
            url: "/api/trpc",
            transformer: superjson,
            headers: () => (clinicToken ? { Authorization: `Bearer ${clinicToken}` } : {}),
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
