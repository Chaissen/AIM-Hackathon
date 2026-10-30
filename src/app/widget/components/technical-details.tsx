"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Time } from "@/components/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block";
import { Skeleton } from "@/components/ui/skeleton";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-types";
import { CHECK_LABEL, checkText } from "@/lib/identity-check-text";
import type { IdentityAttempt } from "@/lib/request-story";
import type { Verdict } from "@/server/identity/checks";
import { useTRPC } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/types";

import { InlineRetry } from "./load-error";
import { ToneMark } from "./request-history";

type FiledResources = RouterOutputs["document"]["filedResources"];
type Resource = Extract<FiledResources, { status: "ok" }>["resources"][number];

const VERDICT: Record<Verdict, { label: string; tone: "success" | "warning" | "destructive" }> = {
  pass: { label: "Passed", tone: "success" },
  hold: { label: "Held", tone: "warning" },
  fail: { label: "Turned away", tone: "destructive" },
};

/** Each login's identity checks in words, the document type's release check, and the resources filed on HAPI. */
export function TechnicalDetails({ requestId, docType, attempts }: { requestId: number; docType: DocumentType; attempts: readonly IdentityAttempt[] }) {
  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Identity checks</CardTitle>
          <CardDescription>{DOCUMENT_TYPES[docType].releaseCheck}</CardDescription>
        </CardHeader>
        <CardContent className="gap-4">
          {attempts.length === 0 ? (
            <p className="text-sm text-dim">Nobody has logged in yet.</p>
          ) : (
            [...attempts].reverse().map((attempt) => <Attempt key={attempt.id} attempt={attempt} />)
          )}
        </CardContent>
      </Card>
      <FiledResourcesCard requestId={requestId} />
    </>
  );
}

function Attempt({ attempt }: { attempt: IdentityAttempt }) {
  const verdict = VERDICT[attempt.verdict];
  return (
    <div className="grid gap-2 border border-hairline bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-loud">
          {attempt.person ?? "A login that could not be finished"}
          <Badge variant={verdict.tone}>{verdict.label}</Badge>
        </span>
        <Time at={attempt.at} className="text-xs text-muted-foreground" />
      </div>
      {attempt.checks.length > 0 && (
        <ul className="grid gap-1.5">
          {attempt.checks.map((check) => (
            <li key={check.check} className="flex gap-2">
              <ToneMark tone={check.result} />
              <span>
                <span className="font-medium">{CHECK_LABEL[check.check]}</span> <span className="text-muted-foreground">{checkText(check)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const UNAVAILABLE: Record<Extract<FiledResources, { status: "unavailable" }>["reason"], string> = {
  fhir_unreachable: "The FHIR server could not be reached.",
  not_found: "A filed resource was not found on the FHIR server.",
};

function FiledResourcesCard({ requestId }: { requestId: number }) {
  const trpc = useTRPC();
  const filed = useQuery(trpc.document.filedResources.queryOptions({ id: requestId }, { retry: false }));

  const content = () => {
    if (filed.error) {
      return (
        <InlineRetry onRetry={() => filed.refetch()}>Could not read the filed resources.</InlineRetry>
      );
    }
    if (filed.isPending) return <Skeleton className="h-24" />;
    switch (filed.data.status) {
      case "none":
        return <p className="text-sm text-dim">Nothing has been filed for this request.</p>;
      case "unavailable":
        return <p className="text-sm text-dim">{UNAVAILABLE[filed.data.reason]}</p>;
      case "ok":
        return <ResourceBrowser resources={filed.data.resources} />;
      default:
        return filed.data satisfies never;
    }
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Filed resources</CardTitle>
        <CardDescription>
          {filed.data?.status === "ok"
            ? `${filed.data.resources.length} resources on the FHIR server, read by the references in the audit log.`
            : "What the answer put on the FHIR server, read by the references in the audit log."}
        </CardDescription>
      </CardHeader>
      <CardContent>{content()}</CardContent>
    </Card>
  );
}

/** The resource list on the left and the chosen resource's JSON on the right, from 36rem of container width. */
function ResourceBrowser({ resources }: { resources: readonly Resource[] }) {
  const [selected, setSelected] = useState(0);
  const shown = resources[selected];
  const json = JSON.stringify(shown.resource, null, 2);
  return (
    <div className="grid gap-3 @xl/main:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="flex flex-wrap gap-1 @xl/main:flex-col" role="group" aria-label="Filed resources">
        {resources.map((resource, i) => (
          <Button
            key={resource.reference}
            size="sm"
            variant={i === selected ? "secondary" : "ghost"}
            className="justify-start"
            aria-pressed={i === selected}
            onClick={() => setSelected(i)}
          >
            {resource.reference}
          </Button>
        ))}
      </div>
      <CodeBlock size="sm">
        <CodeBlockHeader>
          <CodeBlockTitle>{shown.reference}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton value={json} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent className="max-h-120">{json}</CodeBlockContent>
      </CodeBlock>
    </div>
  );
}
