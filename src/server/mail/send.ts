import nodemailer from "nodemailer";

import { env } from "@/env";
import type { Tx } from "@/server/db";
import { smsOutbox } from "@/server/db/schema";
import type { ExpectedPatient } from "@/server/documents/patient-check";
import { checkablePatient, type ContentCategory, forbiddenContent, type RequestEmail, requestEmail, requestSms } from "./message";

export class MessageRefused extends Error {
  constructor(readonly categories: ContentCategory[]) {
    super(`Refused to send the message because it contains ${categories.join(", ")}`);
  }
}

export class IncompletePatient extends Error {
  constructor() {
    super("Refused to send the message because the patient record has no given name, family name, or full birth date to check it against");
  }
}

export async function sendRequestEmail({ to, patient, ...content }: RequestEmail & { to: string; patient: ExpectedPatient }): Promise<void> {
  if (!checkablePatient(patient)) throw new IncompletePatient();
  const email = requestEmail(content);
  const categories = forbiddenContent(email, patient);
  if (categories.length) throw new MessageRefused(categories);

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({
      from: env.MAIL_FROM,
      to,
      subject: email.subject,
      text: email.text,
    });
  } finally {
    transport.close();
  }
}

/** Stores the SMS for the SMS screen in the caller's transaction, so a rollback leaves no SMS behind. */
export async function sendRequestSms(
  tx: Tx,
  { requestId, to, patient, ...content }: RequestEmail & { requestId: number; to: string; patient: ExpectedPatient },
): Promise<void> {
  if (!checkablePatient(patient)) throw new IncompletePatient();
  const { text } = requestSms(content);
  const categories = forbiddenContent({ subject: "", text }, patient);
  if (categories.length) throw new MessageRefused(categories);
  await tx.insert(smsOutbox).values({ requestId, to, body: text });
}
