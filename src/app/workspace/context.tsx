"use client";

import { createContext, useContext, useMemo } from "react";

import type { WorkspaceSessionResponse } from "@/lib/workspace";

type SignedInSession = Extract<WorkspaceSessionResponse, { status: "signed_in" }>;
type Workspace = { session: SignedInSession; signOut: () => void };

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ session, signOut, children }: Workspace & { children: React.ReactNode }) {
  const value = useMemo(() => ({ session, signOut }), [session, signOut]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
