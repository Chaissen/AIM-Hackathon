import { PortalMessage } from "@/components/portal/portal-frame";

// What the sender sees once the answer is in. Neither names the patient or the document type.

export function AnswerFiled({ clinic }: { clinic: string }) {
  return (
    <PortalMessage title="Thank you, your document is filed">
      {clinic} has it now. You can close this page.
    </PortalMessage>
  );
}

/** An earlier upload was filed on this send. The file chosen now was not read. */
export function EarlierAnswerFiled({ clinic }: { clinic: string }) {
  return (
    <PortalMessage title="Thank you, your earlier document is filed">
      {clinic} has it now. The file you just chose was not read. You can close this page.
    </PortalMessage>
  );
}

export function AnswerHeld({ requester }: { requester?: string }) {
  return (
    <PortalMessage title="Thank you, your document arrived">
      {requester ?? "The person who sent the request"} checks it before it is filed. You do not need to do anything else.
      You can close this page.
    </PortalMessage>
  );
}

export function LinkClosed() {
  return <PortalMessage title="This link does not work">Contact the person who sent it to you.</PortalMessage>;
}
