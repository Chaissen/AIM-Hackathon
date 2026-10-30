"use client";

import { createContext, useContext, useMemo, useState } from "react";

import type { DocumentType } from "@/lib/document-types";

import { navigate } from "./use-widget-route";

/** What the New request form starts with. A contact, a directory entry, a patient page, or a preset fills part of it. */
export type RequestDraft = {
  docType: DocumentType;
  patient: string;
  given: string;
  family: string;
  org: string;
  channel: "email" | "sms";
  contact: string;
};

type Draft = {
  draft: Partial<RequestDraft> | null;
  /** Keeps the prefill in memory and opens New request. Names, addresses, and patient choices never go into the hash. */
  startRequest: (prefill: Partial<RequestDraft>) => void;
  clearDraft: () => void;
};

const DraftContext = createContext<Draft | null>(null);

export function DraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<Partial<RequestDraft> | null>(null);
  const value = useMemo<Draft>(
    () => ({
      draft,
      startRequest: (prefill) => {
        setDraft(prefill);
        navigate({ view: "new" });
      },
      clearDraft: () => setDraft(null),
    }),
    [draft],
  );
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): Draft {
  const draft = useContext(DraftContext);
  if (!draft) throw new Error("useDraft needs a DraftProvider above it");
  return draft;
}
