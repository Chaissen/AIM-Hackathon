import { PortalFrame, PortalMessage } from "@/components/portal/portal-frame";

// GET /r/{token}/held: the identity check held, or the request waits for a decision by the person who sent it.
// The same page for every link: it names nobody and nothing about the patient or the document.
export default function HeldPage() {
  return (
    <PortalFrame>
      <PortalMessage title="This request needs a check">
        The person who sent it checks your login first and contacts you. Nothing was shared with you yet. You can close this
        page.
      </PortalMessage>
    </PortalFrame>
  );
}
