"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import superjson from "superjson";

import type { AppRouter } from "@/server/api/root";
import { makeQueryClient } from "./query-client";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

let browserQueryClient: QueryClient | undefined;
const getQueryClient = () =>
  typeof window === "undefined" ? makeQueryClient() : (browserQueryClient ??= makeQueryClient());

// Set by the Element widget once it has a Matrix OpenID token; sent as Bearer token to clinic procedures.
let clinicToken: string | null = null;
export const setClinicToken = (token: string | null) => {
  clinicToken = token;
};

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({ enabled: (op) => process.env.NODE_ENV === "development" && typeof window !== "undefined" && op.direction === "down" && op.result instanceof Error }),
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          headers: () => (clinicToken ? { Authorization: `Bearer ${clinicToken}` } : {}),
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
