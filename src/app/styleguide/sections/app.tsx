import Link from "next/link";

import { EventLabel, OutcomeBadge } from "@/app/audit/audit-table";
import { AnswerForm } from "@/app/r/[token]/answer/answer-form";
import { AnswerFiled, AnswerHeld, EarlierAnswerFiled, LinkClosed } from "@/components/portal/answer-messages";
import { PortalFrame, PortalMessage, Refusal } from "@/components/portal/portal-frame";
import { Button } from "@/components/ui/button";

import { Block } from "./block";
import { EVENTS } from "./fixtures";

export function AppSection() {
  return (
    <>
      <Block title="App: widget">
        <p className="w-full text-sm text-dim">The whole widget with fixture data, at the width of this window.</p>
        <Button asChild>
          <Link href="/styleguide/widget">Seeded</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/styleguide/widget?fixtures=empty">Empty</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/styleguide/widget?fixtures=failing">Failing</Link>
        </Button>
      </Block>

      <Block title="App: audit labels">
        {EVENTS.map((event) => (
          <span key={event} className="flex items-center gap-2 text-sm">
            <EventLabel event={event} />
            <OutcomeBadge entry={{ event, outcome: event === "misdelivery_caught" ? "address_mismatch" : "pass" }} />
          </span>
        ))}
        <OutcomeBadge entry={{ event: "identity_checked", outcome: "fail" }} />
      </Block>

      <Block title="App: outside portal" wide>
        <div className="border border-dashed border-strong">
          <PortalFrame aside="Logged in as Maria Huber">
            <PortalMessage title="Dr. Lena Hofer at Klinikum Beispielstadt sent you a request">
              Log in with ID Austria to see what is needed. You need no account and nothing to install.
            </PortalMessage>
            <AnswerForm token="styleguide" requester="Dr. Lena Hofer" clinic="Klinikum Beispielstadt" />
            <AnswerFiled clinic="Klinikum Beispielstadt" />
            <EarlierAnswerFiled clinic="Klinikum Beispielstadt" />
            <AnswerHeld requester="Dr. Lena Hofer" />
            <LinkClosed />
          </PortalFrame>
        </div>
        <div className="border border-dashed border-strong">
          <Refusal />
        </div>
      </Block>
    </>
  );
}
