// Where `pnpm demo:seed` and `pnpm scenario` read a request's link, as the outside person gets it: from the request
// email in the team inbox, or from the SMS in the demo SMS outbox. Both return the link token whose hash the request
// stores, so a stale email or SMS for another request never counts. They never print a token or a link
// (docs/COMPLIANCE_AND_SAFETY.md), and their errors name request ids only.
import { env } from "@/env";
import { db } from "@/server/db";
import { parseEmail, startFakeSmtp } from "@/server/mail/fake-smtp";
import { listSms } from "@/server/portal/data";
import { hashLinkToken } from "@/server/requests/link-token";
import { getRequest } from "@/server/requests/service";

export class LinkNotFound extends Error {}

const linkPrefix = () => new URL("/r/", env.PUBLIC_URL).href;

/** The tokens of every request link in a text. */
const linkTokens = (text: string) =>
  text
    .split(linkPrefix())
    .slice(1)
    .map((rest) => /^[A-Za-z0-9_-]+/.exec(rest)?.[0] ?? "");

/** The token among `tokens` whose hash request `id` stores. */
async function requestToken(id: number, tokens: string[], where: string): Promise<string> {
  const request = await getRequest(db, id);
  if (!request) throw new LinkNotFound(`request ${id} does not exist`);
  const token = tokens.find((t) => hashLinkToken(t) === request.linkHash);
  if (!token) throw new LinkNotFound(`no ${where} with the link of request ${id}`);
  return token;
}

/**
 * The SMS for request `id` in the demo outbox, as the SMS screen /sms shows it (`listSms`). ordy has no SMS gateway:
 * outside a production build the request service keeps each SMS there (`sendRequestSms`, src/server/requests/sms.ts).
 */
export async function tokenFromSms(id: number): Promise<string> {
  const sms = (await listSms()).filter((m) => m.requestId === id);
  return requestToken(id, sms.flatMap((m) => linkTokens(m.body)), "SMS in the demo outbox");
}

export type TeamInbox = {
  /** The link token in the request email for request `id` to `address`. */
  tokenFromEmail: (id: number, address: string) => Promise<string>;
  close: () => Promise<void>;
};

/**
 * The team inbox for one script run. The only place the scripts read request emails, so a change of the email
 * transport changes this function and nothing else.
 *
 * The scripts send no email (docs/COMPLIANCE_AND_SAFETY.md). `sendRequestEmail` still builds every request email, runs
 * the content check, and hands it to nodemailer, but nodemailer delivers it to an SMTP server in this process, which
 * keeps it (src/server/mail/fake-smtp.ts). Gmail never sees it, so the run needs no app password. Call it before the
 * first request is sent, and close it at the end of the run.
 */
export async function openTeamInbox(): Promise<TeamInbox> {
  const smtp = await startFakeSmtp();
  Object.assign(env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: smtp.port, SMTP_USER: "", MAIL_TEAM_INBOXES: ["demo-seed@ordy.test"] });
  return {
    async tokenFromEmail(id, address) {
      const tokens = smtp.received
        .map((email) => parseEmail(email.raw))
        .filter(({ headers }) => headers.get("to")?.toLowerCase() === address.toLowerCase())
        .flatMap(({ body }) => linkTokens(body));
      return requestToken(id, tokens, `email to ${address}`);
    },
    close: smtp.close,
  };
}
