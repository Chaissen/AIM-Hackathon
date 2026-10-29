import { ShieldCheck } from "lucide-react";
import { Suspense } from "react";

import { PortalFrame, PortalMessage } from "@/components/portal/portal-frame";
import { Button } from "@/components/ui/button";
import { findPublicRequest } from "@/server/portal/data";

const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

// GET /r/{token}: shows only the requesting doctor and clinic and the login button (docs/ARCHITECTURE.md).
export default function RequestLanding({ params }: PageProps<"/r/[token]">) {
  return (
    <Suspense fallback={<PortalFrame>{null}</PortalFrame>}>
      <Landing params={params} />
    </Suspense>
  );
}

async function Landing({ params }: { params: PageProps<"/r/[token]">["params"] }) {
  const { token } = await params;
  const request = await findPublicRequest(token);

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button size="lg" asChild>
            <a href={`/auth/login?token=${encodeURIComponent(token)}`}>
              <ShieldCheck /> Log in with ID Austria
            </a>
          </Button>
          <span className="text-sm text-muted-foreground">Valid until {formatDate(request.expiresAt)}</span>
        </div>
      </section>
      <p className="px-1 text-sm text-muted-foreground">
        Did you not expect this? You can close the page. Only the person it was meant for can open it.
      </p>
    </PortalFrame>
  );
}
