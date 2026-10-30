import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

import { SmsPhone } from "@/components/demo/sms-phone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { demoToolsEnabled } from "@/lib/demo-tools";

// GET /inbox: what the outside person received. The emails are in the team's Gmail inbox, and the SMS screen shows
// every SMS with its working link to whoever opens this page, so a production build answers 404
// (docs/COMPLIANCE_AND_SAFETY.md).

export default function InboxPage() {
  if (!demoToolsEnabled) notFound();
  const [firstInbox] = env.MAIL_TEAM_INBOXES;
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="grid gap-1">
        <p className="eyebrow">Demo only</p>
        <h1 className="text-2xl">Recipient&apos;s inbox</h1>
        <p className="max-w-prose text-sm text-dim">
          What the lab or the rehab clinic received from ordy. Open the link in an email or a text message to answer as the recipient. For test M2,
          open the same link a second time and log in as another person, such as thomas.wagner, who is then turned away.
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-4">
          <h2 className="eyebrow">Emails</h2>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-base">Emails go out through Gmail</CardTitle>
              <CardDescription>Team inboxes: {env.MAIL_TEAM_INBOXES.join(", ")}</CardDescription>
            </CardHeader>
            <CardContent className="grid justify-items-start gap-4">
              <p className="text-sm leading-relaxed">
                ordy sends every request email to the team inboxes, whatever address the request names. The email still shows that address in its To
                line. Open the email in Gmail, then open its link as the recipient.
              </p>
              <Button asChild size="sm">
                <a href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(firstInbox)}`} target="_blank" rel="noopener">
                  Open {firstInbox} in Gmail <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </section>
        <section className="grid content-start gap-4 lg:justify-items-center">
          <h2 className="eyebrow lg:justify-self-start">Text messages</h2>
          <SmsPhone />
        </section>
      </div>
    </main>
  );
}
