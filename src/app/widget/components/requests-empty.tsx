import { Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { RequestFilter } from "@/lib/request-status";

import { widgetHref } from "../widget-route";

const EMPTY: Record<RequestFilter, { title: string; text: string }> = {
  all: { title: "No requests yet", text: "Ask a lab, a rehab clinic, or a practice for a document. The request goes out by email or text message." },
  open: { title: "No open requests", text: "Every request has been answered or closed." },
  attention: { title: "Nothing needs your attention", text: "ordy asks you only to check an address, a sender, or a document." },
  received: { title: "No documents received yet", text: "A received document is in the patient record." },
  closed: { title: "No closed requests", text: "Cancelled, expired, and locked requests show here." },
};

export function RequestsEmpty({ filter }: { filter: RequestFilter }) {
  const { title, text } = EMPTY[filter];
  return (
    <Empty className="border border-dashed border-strong">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild size="sm">
          <a href={widgetHref({ view: "new" })}>New request</a>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
