import type { DocumentType } from "@/lib/document-types";

// Data the portal pages need. The tables and the SMS log do not exist yet, so each loader
// returns "nothing found" until its task lands. Replace the body, keep the signature.

/** What the outside person may see before the identity check: the requester and the clinic only. */
export type PublicRequest = { requester: string; clinic: string; expiresAt: Date };

/** What the outside person sees after the identity check passed. */
export type AnswerContext = PublicRequest & {
  docType: DocumentType;
  patient: { name: string; birthDate: string };
};

export type SmsMessage = { id: number; to: string; body: string; sentAt: Date };

// TODO(T04): look up the request by the SHA-256 hash of the token, check state and expiry, write `link_opened`.
export async function findPublicRequest(token: string): Promise<PublicRequest | null> {
  void token;
  return null;
}

// TODO(T04, T07): load the request bound to the ID Austria session.
export async function findAnswerContext(token: string, requestId: number): Promise<AnswerContext | null> {
  void token;
  void requestId;
  return null;
}

// TODO: read the SMS the request service would have sent. No task owns this, because T06 sends email only.
export async function listSms(): Promise<SmsMessage[]> {
  return [];
}
