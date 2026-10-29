import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { PortalFrame, PortalMessage } from "@/components/portal/portal-frame";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { EID_SESSION_COOKIE, readEidSession } from "@/server/auth/eid-session";
import { findAnswerContext } from "@/server/portal/data";
import { AnswerForm } from "./answer-form";

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// GET /r/{token}/answer: only after the identity check passed (docs/ARCHITECTURE.md, "Outside portal").
export default function AnswerPage({ params }: PageProps<"/r/[token]/answer">) {
  return (
    <Suspense fallback={<PortalFrame>{null}</PortalFrame>}>
      <Answer params={params} />
    </Suspense>
  );
}

async function Answer({ params }: { params: PageProps<"/r/[token]/answer">["params"] }) {
  const { token } = await params;
  const session = await readEidSession((await cookies()).get(EID_SESSION_COOKIE)?.value);
  if (!session) redirect(`/r/${encodeURIComponent(token)}`);

  const ctx = await findAnswerContext(token, session.requestId);
  if (!ctx) {
    return (
      <PortalFrame>
        <PortalMessage title="This link does not work">Contact the person who sent it to you.</PortalMessage>
      </PortalFrame>
    );
  }

  return (
    <PortalFrame aside={`Logged in as ${session.givenName} ${session.familyName}`}>
      <section className="grid gap-2 rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          {ctx.requester}, {ctx.clinic} asks for
        </p>
        <h1 className="text-xl font-semibold text-balance">
          {DOCUMENT_TYPES[ctx.docType].label} for {ctx.patient.name}, born {formatDate(ctx.patient.birthDate)}
        </h1>
      </section>
      <AnswerForm />
    </PortalFrame>
  );
}
