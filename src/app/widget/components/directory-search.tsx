"use client";

import { useQuery } from "@tanstack/react-query";
import { Building, Search, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

import { type RequestDraft, useDraft } from "../draft";

// The eHVD search of the Contacts view. The real directory has hundreds of entries and GdaSearch needs a name, so it
// is a search box, run on Enter, over directory.search (src/server/ehvd/search.ts).

type DirectorySearch = RouterOutputs["directory"]["search"];
type DirectoryEntry = Extract<DirectorySearch, { status: "ok" }>["entries"][number];

// directory.search takes z.string().trim().min(2).max(60); shorter names never leave the browser.
const MIN_LENGTH = 2;
const MAX_LENGTH = 60;

/** What was last submitted: nothing, a name too short to search, or a name the eHVD is asked for. */
type Submitted = { kind: "none" } | { kind: "short" } | { kind: "name"; name: string };

/** The New request prefill for an active person: the suggested document type, the name, and the first organisation. */
function draftOf(entry: DirectoryEntry): Partial<RequestDraft> {
  const [org] = entry.memberOf.flatMap((m) => m.name ?? []);
  return {
    ...(entry.suggestedDocType !== null && { docType: entry.suggestedDocType }),
    ...(entry.given !== null && { given: entry.given }),
    family: entry.family,
    ...(org !== undefined && { org }),
  };
}

export function DirectorySearch() {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState<Submitted>({ kind: "none" });
  const name = submitted.kind === "name" ? submitted.name : null;
  const trpc = useTRPC();
  const search = useQuery(trpc.directory.search.queryOptions({ name: name ?? "" }, { enabled: name !== null, retry: false, staleTime: 60_000 }));
  const { startRequest } = useDraft();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    setSubmitted(trimmed.length < MIN_LENGTH ? { kind: "short" } : { kind: "name", name: trimmed });
  };

  return (
    <div className="grid gap-3">
      <form role="search" onSubmit={submit}>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Name, such as Brandl or Kanalstraße"
            aria-label="Search the healthcare directory"
            maxLength={MAX_LENGTH}
            enterKeyHint="search"
            autoComplete="off"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="secondary">
              Search
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      {submitted.kind === "none" ? (
        <Hint>Every entry of the eHVD, active or not. The search matches the family name, so &quot;Brandl&quot; finds Eva Brandl and Eva Brandl-Huber.</Hint>
      ) : submitted.kind === "short" ? (
        <Hint>Type at least two letters.</Hint>
      ) : search.isPending ? (
        <p className="flex items-center gap-2 text-sm text-dim" aria-busy>
          <Spinner /> Searching the eHVD for &quot;{submitted.name}&quot; …
        </p>
      ) : search.isError ? (
        <p role="alert" className="text-sm text-destructive">
          The search did not go through. Check your Element sign-in, then try again.
        </p>
      ) : (
        <Results name={submitted.name} result={search.data} onRequest={(entry) => startRequest(draftOf(entry))} />
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-dim">{children}</p>;
}

function Results({ name, result, onRequest }: { name: string; result: DirectorySearch; onRequest: (entry: DirectoryEntry) => void }) {
  switch (result.status) {
    case "ok":
      if (result.entries.length === 0) return <Hint>No entry has the name &quot;{name}&quot;. Try the family name alone, or another spelling.</Hint>;
      return (
        <ItemGroup>
          {result.entries.map((entry) => (
            <Entry key={entry.oid} entry={entry} onRequest={onRequest} />
          ))}
        </ItemGroup>
      );
    case "too_many":
      return <Hint>More than 50 entries match &quot;{name}&quot;. Add a first name or more letters.</Hint>;
    case "invalid":
      return (
        <p role="alert" className="text-sm text-warning">
          {result.message}
        </p>
      );
    case "unavailable":
      return (
        <p role="alert" className="text-sm text-destructive">
          The eHVD cannot be reached right now. Try again in a moment.
        </p>
      );
    default:
      return result satisfies never;
  }
}

function Entry({ entry, onRequest }: { entry: DirectoryEntry; onRequest: (entry: DirectoryEntry) => void }) {
  const what = [...entry.roles, ...entry.specialisations].join(" · ");
  const memberOf = entry.memberOf.length > 0 ? `Member of ${entry.memberOf.map((m) => m.name ?? m.oid).join(", ")}` : null;
  const where = [memberOf, entry.mailDomain, entry.city].filter((part) => part !== null).join(" · ");
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">{entry.kind === "person" ? <UserRound /> : <Building />}</ItemMedia>
      <ItemContent>
        <ItemTitle>
          {entry.name}
          {entry.active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
        </ItemTitle>
        {what && <ItemDescription>{what}</ItemDescription>}
        {where && <ItemDescription>{where}</ItemDescription>}
        <span className="font-mono text-xs text-muted-foreground">{entry.oid}</span>
      </ItemContent>
      {entry.kind === "person" && entry.active && (
        <ItemActions>
          <Button size="sm" variant="outline" onClick={() => onRequest(entry)}>
            Request
          </Button>
        </ItemActions>
      )}
    </Item>
  );
}
