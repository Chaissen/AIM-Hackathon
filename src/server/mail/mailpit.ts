import { z } from "zod";

import { env } from "@/env";

// The emails in Mailpit with their portal links, for the demo page /inbox. Server only: like Mailpit's own page, it
// hands every link to whoever can open the page.

export type InboxEmail = { id: string; to: string[]; subject: string; at: Date; text: string; links: string[] };
export type Inbox =
  | { status: "ok"; emails: InboxEmail[] }
  /** No answer within MAILPIT_TIMEOUT_MS, an HTTP error, or JSON that is not Mailpit's */
  | { status: "unreachable" };

const MAILPIT_TIMEOUT_MS = 5000;

const messageList = z.object({
  messages: z.array(
    z.object({
      ID: z.string(),
      To: z.array(z.object({ Address: z.string() })).nullable(),
      Subject: z.string(),
      Created: z.iso.datetime({ offset: true }),
    }),
  ),
});
const message = z.object({ Text: z.string() });

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${env.MAILPIT_API_URL}/api/v1/${path}`, { signal: AbortSignal.timeout(MAILPIT_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Mailpit answered ${response.status} for ${path}`);
  return schema.parse(await response.json());
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);
const words = (text: string) =>
  [...text]
    .map((c) => (WHITESPACE.has(c) ? " " : c))
    .join("")
    .split(" ")
    .filter(Boolean);

/** The words of the text that are links to the outside portal, each once. */
function portalLinks(text: string): string[] {
  const portal = new URL("/r/", env.PUBLIC_URL).href;
  return [...new Set(words(text).filter((word) => word.startsWith(portal) && URL.canParse(word)))];
}

/** The newest `limit` emails, newest first, as Mailpit lists them. */
export async function listInboxEmails(limit = 50): Promise<Inbox> {
  try {
    const { messages } = await get(`messages?limit=${limit}`, messageList);
    const texts = await Promise.all(messages.map((m) => get(`message/${encodeURIComponent(m.ID)}`, message)));
    return {
      status: "ok",
      emails: messages.map((m, i) => {
        const text = texts[i].Text.replaceAll("\r\n", "\n");
        return { id: m.ID, to: (m.To ?? []).map((a) => a.Address), subject: m.Subject, at: new Date(m.Created), text, links: portalLinks(text) };
      }),
    };
  } catch {
    return { status: "unreachable" };
  }
}
