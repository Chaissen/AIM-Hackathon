import { PortalFrame, PortalMessage } from "@/components/portal/portal-frame";

// GET /auth/failed: where /auth/login and /auth/callback send a login without a link token or a valid login cookie.
export default function LoginFailed() {
  return (
    <PortalFrame>
      <PortalMessage title="This login has expired">Open the link you received again.</PortalMessage>
    </PortalFrame>
  );
}
