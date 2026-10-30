"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

import { type DirectoryEntry, DirectoryTable } from "./directory-table";

// The healthcare directory of the Contacts view. The eHVD has no call that lists entries, and GdaSearch needs a name, so
// the view lists the entries of EHVD_DIRECTORY_OIDS (directory.listed, src/server/ehvd/listing.ts) until a search is
// submitted with Enter, and then shows the hits of directory.search (src/server/ehvd/search.ts) in the same table.

type DirectorySearchResult = RouterOutputs["directory"]["search"];

// directory.search takes z.string().trim().min(2).max(60); shorter names never leave the browser.
const MIN_LENGTH = 2;
const MAX_LENGTH = 60;

/** What was last submitted: nothing, a name too short to search, or a name the eHVD is asked for. */
type Submitted = { kind: "none" } | { kind: "short" } | { kind: "name"; name: string };

/** directory.listed, shared by the directory and the titles in "People you asked". It changes only with the eHVD. */
export function useDirectoryListing() {
  const trpc = useTRPC();
  return useQuery(trpc.directory.listed.queryOptions(undefined, { retry: false, staleTime: 5 * 60_000 }));
}

const same = (a: string, b: string) => a.normalize("NFC").trim().toLowerCase() === b.normalize("NFC").trim().toLowerCase();

/**
 * The eHVD title, such as "Dr.", of a listed person with exactly this given name and family name who is a member of
 * the organisation. Null for anyone else: a person outside the listing gets no title rather than one eHVD call each.
 */
export function listedTitle(entries: readonly DirectoryEntry[], contact: { given: string; family: string; org: string }): string | null {
  const entry = entries.find(
    (e) =>
      e.kind === "person" &&
      e.given !== null &&
      same(e.given, contact.given) &&
      same(e.family, contact.family) &&
      e.memberOf.some((m) => m.name !== null && same(m.name, contact.org)),
  );
  return entry?.title ?? null;
}

export function DirectorySearch() {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState<Submitted>({ kind: "none" });
  const input = useRef<HTMLInputElement>(null);
  const name = submitted.kind === "name" ? submitted.name : null;
  const trpc = useTRPC();
  const search = useQuery(trpc.directory.search.queryOptions({ name: name ?? "" }, { enabled: name !== null, retry: false, staleTime: 60_000 }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    setSubmitted(trimmed === "" ? { kind: "none" } : trimmed.length < MIN_LENGTH ? { kind: "short" } : { kind: "name", name: trimmed });
  };
  const showListed = () => {
    setText("");
    setSubmitted({ kind: "none" });
    input.current?.focus();
  };

  return (
    <div className="grid gap-3">
      <form role="search" onSubmit={submit}>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && submitted.kind !== "none") showListed();
            }}
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
      {submitted.kind === "name" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p role="status" className="min-w-0 text-sm wrap-anywhere text-dim">
              Search results for &quot;{submitted.name}&quot;
            </p>
            <Button size="sm" variant="ghost" onClick={showListed}>
              <ArrowLeft /> Show listed entries
            </Button>
          </div>
          {search.isPending ? (
            <p className="flex items-center gap-2 text-sm text-dim" aria-busy>
              <Spinner /> Searching the eHVD for &quot;{submitted.name}&quot; …
            </p>
          ) : search.isError ? (
            <p role="alert" className="text-sm text-destructive">
              The search did not go through. Check your network sign-in, then try again.
            </p>
          ) : (
            <Results name={submitted.name} result={search.data} />
          )}
        </>
      ) : (
        <>
          {submitted.kind === "short" && <Hint>Type at least two letters.</Hint>}
          <Listed />
        </>
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-dim">{children}</p>;
}

function Listed() {
  const { data, error, isPending } = useDirectoryListing();

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load the directory. Check your network sign-in, then reload this page.
      </p>
    );
  }
  if (isPending) return <Skeleton className="h-40" aria-busy />;
  if (data.status === "unavailable") {
    return (
      <p role="alert" className="text-sm text-destructive">
        The eHVD cannot be reached right now, so the directory cannot be shown. Try again in a moment.
      </p>
    );
  }
  if (data.entries.length === 0) return <Hint>No entries are listed here. Search by family or organisation name to find doctors and organisations.</Hint>;

  return (
    <>
      <Hint>Entries your clinic lists here. Search by family or organisation name to find anyone else, active or not.</Hint>
      {data.failed > 0 && (
        <p role="alert" className="text-sm text-warning">
          {data.failed === 1 ? "1 entry" : `${data.failed} entries`} could not be loaded from the eHVD.
        </p>
      )}
      <DirectoryTable entries={data.entries} label="Listed entries of the healthcare directory" />
    </>
  );
}

function Results({ name, result }: { name: string; result: DirectorySearchResult }) {
  switch (result.status) {
    case "ok":
      if (result.entries.length === 0) return <Hint>No entry has the name &quot;{name}&quot;. Try the family name alone, or another spelling.</Hint>;
      return <DirectoryTable entries={result.entries} label={`Search results for ${name}`} />;
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
