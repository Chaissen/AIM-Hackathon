import nodemailer from "nodemailer";

import { env } from "@/env";
import type { ExpectedPatient } from "@/server/documents/patient-check";
import { checkablePatient, type ContentCategory, forbiddenContent, type RequestEmail, requestEmail } from "./message";

export class MessageRefused extends Error {
  constructor(readonly categories: ContentCategory[]) {
    super(`Refused to send the email because it contains ${categories.join(", ")}`);
  }
}

export class IncompletePatient extends Error {
  constructor() {
    super("Refused to send the email because the patient record has no given name, family name, or birth date to check it against");
  }
}

export async function sendRequestEmail({ to, patient, ...content }: RequestEmail & { to: string; patient: ExpectedPatient }): Promise<void> {
  const email = requestEmail(content);
  const categories = forbiddenContent(email, patient);
  if (categories.length) throw new MessageRefused(categories);
  if (!checkablePatient(patient)) throw new IncompletePatient();

  const teamInboxes = env.MAIL_TEAM_INBOXES;
  if (env.SMTP_USER && !teamInboxes.length) throw new Error("SMTP_USER is set but MAIL_TEAM_INBOXES is empty, so ordy sends no email");

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: Boolean(env.SMTP_USER),
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
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
      envelope: { from: env.MAIL_FROM, to: teamInboxes.length ? teamInboxes : [to] },
    });
  } finally {
    transport.close();
  }
}
