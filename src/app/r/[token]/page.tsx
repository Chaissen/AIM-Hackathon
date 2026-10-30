import { ShieldCheck } from "lucide-react";
import { headers } from "next/headers";
import { Suspense } from "react";

import { PortalFrame, PortalMessage } from "@/components/portal/portal-frame";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { findPublicRequest } from "@/server/portal/data";

const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// GET /r/{token}: shows only the requesting doctor and clinic and the login button (docs/ARCHITECTURE.md).
export default function RequestLanding(props: PageProps<"/r/[token]">) {
  return (
    <Suspense fallback={<PortalFrame>{null}</PortalFrame>}>
      <Landing {...props} />
    </Suspense>
  );
}

async function Landing({ params, searchParams }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const loginFailed = (await searchParams).login === "failed";
  // X-Forwarded-For as Next.js passes it on. Next.js fills it from the socket only when the client sent none, so without
  // a proxy in front the client can set it. The hash is a hint for the audit log, not proof. Only the hash is stored.
  const ip = (await headers()).get("x-forwarded-for")?.split(",").at(-1)?.trim() || null;
  const request = await findPublicRequest(token, { ip });

  if (!request) {
    return (
      <PortalFrame>
        <PortalMessage title="This link does not work">
          It may be incomplete or no longer valid. Contact the person who sent it to you.
        </PortalMessage>
      </PortalFrame>
    );
  }

  return (
    <PortalFrame aside={request.clinic}>
      <section className="grid gap-5 rounded-xl border bg-card p-6">
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Secure request</p>
          <h1 className="text-xl font-semibold text-balance">
            {request.requester} at {request.clinic} sent you a request
          </h1>
          <p className="text-muted-foreground">
            Log in with ID Austria to see what is needed. You need no account and nothing to install.
          </p>
        </div>
        {loginFailed && (
          <Alert variant="destructive">
            <AlertTitle>The login did not work. Try again.</AlertTitle>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action="/auth/login" method="post">
            <input type="hidden" name="token" value={token} />
            <Button size="lg" type="submit">
              <ShieldCheck /> Log in with ID Austria
            </Button>
          </form>
          <span className="text-sm text-muted-foreground">Valid until {formatDate(request.expiresAt)}</span>
        </div>
      </section>
      <p className="px-1 text-sm text-muted-foreground">
        Did you not expect this? You can close the page. Only the person it was meant for can open it.
      </p>
    </PortalFrame>
  );
}
