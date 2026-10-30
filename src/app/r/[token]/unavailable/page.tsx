import { Suspense } from "react";

import { PortalFrame, PortalMessage } from "@/components/portal/portal-frame";
import { Button } from "@/components/ui/button";

// GET /r/{token}/unavailable: ID Austria could not be reached, or the request changed during the login. Try again.
export default function UnavailablePage({ params }: PageProps<"/r/[token]/unavailable">) {
  return (
    <PortalFrame>
      <PortalMessage title="The login could not be finished">
        <div className="grid gap-4">
          <p>Nothing was shared with you. Try again in a few minutes.</p>
          <Suspense fallback={null}>
            <TryAgain params={params} />
          </Suspense>
        </div>
      </PortalMessage>
    </PortalFrame>
  );
}

async function TryAgain({ params }: { params: PageProps<"/r/[token]/unavailable">["params"] }) {
  const { token } = await params;
  return (
    <Button asChild className="justify-self-start">
      <a href={`/r/${encodeURIComponent(token)}`}>Try again</a>
    </Button>
  );
}
