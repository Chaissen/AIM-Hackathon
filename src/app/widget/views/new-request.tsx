"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { demoToolsEnabled } from "@/lib/demo-tools";
import { DOCUMENT_TYPES } from "@/lib/document-types";

import { type RequestDraft, useDraft } from "../draft";
import { REQUEST_PRESETS } from "../presets";
import { RequestForm } from "../request-form";
import { ShellPage } from "../shell";

const EMPTY: RequestDraft = { docType: "lab-result", patient: "", given: "", family: "", org: "", channel: "email", contact: "" };

/** A prefill from a contact, a directory entry, a patient page, or a preset, completed to a whole draft. */
function draftFrom(prefill: Partial<RequestDraft> | null): RequestDraft {
  const docType = prefill?.docType ?? EMPTY.docType;
  return { ...EMPTY, docType, channel: DOCUMENT_TYPES[docType].channel, ...prefill };
}

export function NewRequestView() {
  const { draft, clearDraft } = useDraft();
  // The prefill is read once; what Dr. Hofer types stays here until the request is sent or the view closes.
  const [value, setValue] = useState<RequestDraft>(() => draftFrom(draft));

  return (
    <ShellPage crumbs={[{ label: "New request" }]} actions={demoToolsEnabled && <PresetMenu onPick={setValue} />}>
      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <div className="grid gap-1">
          <h1 className="text-2xl">New request</h1>
          <p className="text-sm text-dim">Ask someone outside the network for a document. They open the link with ID Austria and answer in the browser.</p>
        </div>
        <RequestForm value={value} onChange={setValue} onCreated={clearDraft} />
      </div>
    </ShellPage>
  );
}

function PresetMenu({ onPick }: { onPick: (draft: RequestDraft) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Sparkles data-icon="inline-start" /> Examples
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        {REQUEST_PRESETS.map((preset) => (
          <DropdownMenuItem key={preset.label} onSelect={() => onPick(preset.draft)}>
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
