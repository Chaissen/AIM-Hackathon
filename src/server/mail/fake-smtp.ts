import { createServer, type Socket } from "node:net";

// An SMTP server on 127.0.0.1 that keeps every email it receives in memory and delivers none. The mail tests and
// `pnpm demo:seed` send to it, so neither reaches Gmail. It offers no STARTTLS and no login.

export type ReceivedEmail = { sender: string; recipients: string[]; raw: string };
export type FakeSmtp = { port: number; received: ReceivedEmail[]; close: () => Promise<void> };

/** Replies to one SMTP client and adds each email it sends to `received`. */
function smtpSession(socket: Socket, received: ReceivedEmail[]) {
  let buffer = "";
  let envelope: Omit<ReceivedEmail, "raw"> | undefined;
  let data: Omit<ReceivedEmail, "raw"> | undefined;
  const reply = (line: string) => socket.write(`${line}\r\n`);
  const address = (line: string) => line.slice(line.indexOf("<") + 1, line.indexOf(">"));

  reply("220 fake-smtp.test ESMTP");
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      if (data) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end === -1) return;
        const lines = buffer.slice(0, end + 2).split("\r\n");
        received.push({ ...data, raw: lines.map((line) => (line.startsWith(".") ? line.slice(1) : line)).join("\r\n") });
        buffer = buffer.slice(end + 5);
        data = undefined;
        reply("250 Queued");
        continue;
      }
      const end = buffer.indexOf("\r\n");
      if (end === -1) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const verb = line.split(" ")[0].toUpperCase();
      if (verb === "EHLO" || verb === "HELO") reply("250 fake-smtp.test");
      else if (verb === "MAIL") {
        envelope = { sender: address(line), recipients: [] };
        reply("250 OK");
      } else if (verb === "RCPT" && envelope) {
        envelope.recipients.push(address(line));
        reply("250 OK");
      } else if (verb === "DATA" && envelope) {
        data = envelope;
        envelope = undefined;
        reply("354 End data with <CR><LF>.<CR><LF>");
      } else if (verb === "QUIT") {
        reply("221 Bye");
        socket.end();
      } else reply("503 Bad sequence of commands");
    }
  });
}

/** Starts the server on a free port of 127.0.0.1. An email is in `received` before the client hears 250 for it. */
export async function startFakeSmtp(): Promise<FakeSmtp> {
  const received: ReceivedEmail[] = [];
  const server = createServer((socket) => smtpSession(socket, received));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("The fake SMTP server did not get a TCP port");
  return { port: address.port, received, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** Undoes quoted-printable: soft line breaks, then `=XX` bytes, read as UTF-8. */
function decodeQuotedPrintable(text: string): string {
  const bytes = text.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
}

/** The headers by lowercase name, with folded lines joined, and the body with LF line ends, decoded if quoted-printable. */
export function parseEmail(raw: string) {
  const blank = raw.indexOf("\r\n\r\n");
  const lines: string[] = [];
  for (const line of raw.slice(0, blank).split("\r\n")) {
    if (line.startsWith(" ") || line.startsWith("\t")) lines.push(`${lines.pop()}${line}`);
    else lines.push(line);
  }
  const headers = new Map(lines.map((line) => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
  const body = raw.slice(blank + 4).replaceAll("\r\n", "\n");
  return { headers, body: headers.get("content-transfer-encoding")?.toLowerCase() === "quoted-printable" ? decodeQuotedPrintable(body) : body };
}
