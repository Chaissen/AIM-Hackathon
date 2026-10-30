import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AnswerFiled, AnswerHeld, LinkClosed } from "@/components/portal/answer-messages";
import { PortalFrame } from "@/components/portal/portal-frame";
import { env } from "@/env";
import { DOCUMENT_TYPES } from "@/lib/document-types";
import { EID_SESSION_COOKIE, readEidSession } from "@/server/auth/eid-session";
import { loadAnswerPage } from "@/server/portal/answer-page";
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
  const landing = `/r/${encodeURIComponent(token)}`;
  const session = await readEidSession((await cookies()).get(EID_SESSION_COOKIE)?.value);
  if (!session) redirect(landing);
  const page = await loadAnswerPage(token, session);

  switch (page.page) {
    case "login":
      redirect(landing);
    case "closed":
      return (
        <PortalFrame>
          <LinkClosed />
        </PortalFrame>
      );
    case "identity_held":
      redirect(`${landing}/held`);
    case "held":
      return (
        <PortalFrame>
          <AnswerHeld />
        </PortalFrame>
      );
    case "filed":
      return (
        <PortalFrame>
          <AnswerFiled clinic={env.CLINIC_NAME} />
        </PortalFrame>
      );
  }

  const { context } = page;
  return (
    <PortalFrame aside={`Logged in as ${session.givenName} ${session.familyName}`}>
      <section className="grid gap-2 rounded-xl border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          {context.requester}, {context.clinic} asks for
        </p>
        <h1 className="text-xl font-semibold text-balance">
          {DOCUMENT_TYPES[context.docType].label} for {context.patient.name}, born {formatDate(context.patient.birthDate)}
        </h1>
      </section>
      <AnswerForm token={token} requester={context.requester} clinic={context.clinic} />
    </PortalFrame>
  );
}
