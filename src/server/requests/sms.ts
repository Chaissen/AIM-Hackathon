import { desc, eq, inArray } from "drizzle-orm";

import { demoToolsEnabled } from "@/lib/demo-tools";
import type { Db, Tx } from "@/server/db";
import { smsOutbox } from "@/server/db/schema";
import type { ExpectedPatient } from "@/server/documents/patient-check";
import { checkablePatient, forbiddenContent, type RequestEmail, requestSms } from "@/server/mail/message";
import { IncompletePatient, MessageRefused } from "@/server/mail/send";

// The request SMS (docs/ARCHITECTURE.md, "Outgoing messages"). ordy has no SMS gateway. Outside a production build the
// SMS goes into the demo outbox `sms_outbox`, which /sms and /inbox show, as a mail catcher shows email. Its body holds
// the link token, so a production build stores nothing and refuses the SMS with NoSmsGateway instead.

/** A production build has no SMS gateway and no outbox, so it cannot send an SMS request. */
export class NoSmsGateway extends Error {
  constructor() {
    super("This build has no SMS gateway, so it cannot send an SMS");
  }
}

export type RequestSms = RequestEmail & { requestId: number; to: string; patient: ExpectedPatient };

/**
 * Runs the content check on the SMS, as `sendRequestEmail` does on the email, and stores it in the outbox in `tx`: the
 * transaction that stores the request as sent, so a rollback removes the SMS too. Throws IncompletePatient or
 * MessageRefused and stores nothing when the check cannot pass, and NoSmsGateway without the outbox (`outbox` false).
 */
export async function sendRequestSms(tx: Db | Tx, { requestId, to, patient, ...content }: RequestSms, outbox = demoToolsEnabled): Promise<void> {
  if (!checkablePatient(patient)) throw new IncompletePatient();
  const { text } = requestSms(content);
  const categories = forbiddenContent({ subject: "", text }, patient);
  if (categories.length) throw new MessageRefused(categories);
  if (!outbox) throw new NoSmsGateway();
  await tx.insert(smsOutbox).values({ requestId, to, body: text });
}

/**
 * Deletes the SMS of requests that closed, so the outbox never shows a link that no longer works and keeps no token
 * longer than its link lives. The request service calls it wherever a request leaves the open states.
 */
export async function deleteSms(db: Db | Tx, requestIds: number[]): Promise<void> {
  if (requestIds.length) await db.delete(smsOutbox).where(inArray(smsOutbox.requestId, requestIds));
}

export type StoredSms = typeof smsOutbox.$inferSelect;

/** The outbox, newest first, or one request's SMS. Empty in a production build, which stores none. */
export async function readSmsOutbox(db: Db, { requestId, limit = 50 }: { requestId?: number; limit?: number } = {}): Promise<StoredSms[]> {
  if (!demoToolsEnabled) return [];
  return db
    .select()
    .from(smsOutbox)
    .where(requestId === undefined ? undefined : eq(smsOutbox.requestId, requestId))
    .orderBy(desc(smsOutbox.sentAt), desc(smsOutbox.id))
    .limit(limit);
}
