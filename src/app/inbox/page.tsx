import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { SmsPhone } from "@/components/demo/sms-phone";
import { Time } from "@/components/time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { demoToolsEnabled } from "@/lib/demo-tools";
import { type InboxEmail, listInboxEmails } from "@/server/mail/mailpit";

// GET /inbox: what the outside person received, the emails from Mailpit and the SMS screen, with a link into the portal
// per message. Like Mailpit's own page it hands every link to whoever opens it, so a production build answers 404
// (docs/COMPLIANCE_AND_SAFETY.md). Mailpit is read at request time, inside a Suspense boundary.

export default function InboxPage() {
  if (!demoToolsEnabled) notFound();
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="grid gap-1">
        <p className="eyebrow">Demo only</p>
        <h1 className="text-2xl">Recipient&apos;s inbox</h1>
        <p className="max-w-prose text-sm text-dim">
          What the lab or the rehab clinic received from ordy. Open a link to answer as the recipient. For test M2, open the same link a second time
          and log in as another person, such as thomas.wagner, who is then turned away.
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-4">
          <h2 className="eyebrow">Emails</h2>
          <Suspense fallback={<p className="text-sm text-dim">Loading emails …</p>}>
            <Emails />
          </Suspense>
        </section>
        <section className="grid content-start gap-4 lg:justify-items-center">
          <h2 className="eyebrow lg:justify-self-start">Text messages</h2>
          <SmsPhone />
        </section>
      </div>
    </main>
  );
}

async function Emails() {
  await connection();
  const inbox = await listInboxEmails();
  switch (inbox.status) {
    case "unreachable":
      return (
        <Alert variant="destructive">
          <AlertTitle>Mailpit cannot be reached</AlertTitle>
          <AlertDescription>Nothing answered at {env.MAILPIT_API_URL}. Start the Mailpit container, then reload this page.</AlertDescription>
        </Alert>
      );
    case "gmail":
      return (
        <Alert>
          <AlertTitle>Emails go out through Gmail</AlertTitle>
          <AlertDescription>SMTP_USER is set, so Mailpit receives nothing. Look in the team inboxes from MAIL_TEAM_INBOXES instead.</AlertDescription>
        </Alert>
      );
    case "ok":
      if (inbox.emails.length === 0) return <p className="text-sm text-dim">No emails yet. Send a request from the widget.</p>;
      return (
        <div className="grid gap-4">
          {inbox.emails.map((email) => (
            <Email key={email.id} email={email} />
          ))}
        </div>
      );
    default:
      return inbox satisfies never;
  }
}

function Email({ email }: { email: InboxEmail }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-base">{email.subject}</CardTitle>
        <CardDescription>
          To {email.to.join(", ")} · <Time at={email.at} />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">{email.text}</p>
        {email.links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {email.links.map((link) => (
              <Button key={link} asChild size="sm">
                <a href={link} target="_blank" rel="noopener">
                  Open as recipient <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
