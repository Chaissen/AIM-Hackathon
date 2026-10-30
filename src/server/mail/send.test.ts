import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { test, type TestContext } from "node:test";

import { env } from "@/env";
import { MessageRefused, sendRequestEmail } from "./send";

type Received = { sender: string; recipients: string[]; raw: string };

/** Replies to one SMTP client and adds each email it sends to `received`. Offers no STARTTLS and no login. */
function smtpSession(socket: Socket, received: Received[]) {
  let buffer = "";
  let envelope: Omit<Received, "raw"> | undefined;
  let data: Omit<Received, "raw"> | undefined;
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

/** An SMTP server on 127.0.0.1 for this test. `env` sends to it, never to Gmail, until the test ends. */
async function fakeSmtp(t: TestContext): Promise<Received[]> {
  const received: Received[] = [];
  const server = createServer((socket) => smtpSession(socket, received));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object", "the fake SMTP server listens on a TCP port");

  const saved = { SMTP_HOST: env.SMTP_HOST, SMTP_PORT: env.SMTP_PORT, SMTP_USER: env.SMTP_USER, MAIL_FROM: env.MAIL_FROM, MAIL_TEAM_INBOXES: env.MAIL_TEAM_INBOXES };
  Object.assign(env, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: address.port,
    SMTP_USER: "",
    MAIL_FROM: "ordy · Klinikum Beispielstadt <request-service@ordy.test>",
    MAIL_TEAM_INBOXES: ["team@ordy.test", "second@ordy.test"],
  });
  t.after(async () => {
    Object.assign(env, saved);
    await new Promise((resolve) => server.close(resolve));
  });
  return received;
}

/** The headers by lowercase name, with folded lines joined, and the body with LF line ends. */
function parseEmail(raw: string) {
  const blank = raw.indexOf("\r\n\r\n");
  const lines: string[] = [];
  for (const line of raw.slice(0, blank).split("\r\n")) {
    if (line.startsWith(" ") || line.startsWith("\t")) lines.push(`${lines.pop()}${line}`);
    else lines.push(line);
  }
  const headers = new Map(lines.map((line) => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
  return { headers, body: raw.slice(blank + 4).replaceAll("\r\n", "\n") };
}

const request1 = {
  to: "eva.brandl@labor-kanal.example",
  requester: "Dr. Lena Hofer",
  clinic: "Klinikum Beispielstadt",
  link: "http://localhost:3010/r/5f2c8a91d04e7b36",
  expiresAt: new Date("2026-11-05T10:00:00+01:00"),
  patient: { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" },
};

test("request 1's email goes to the team inboxes as plain text addressed to Dr. Brandl", async (t) => {
  const received = await fakeSmtp(t);
  await sendRequestEmail(request1);

  assert.equal(received.length, 1);
  const { headers, body } = parseEmail(received[0].raw);
  assert.deepEqual(
    {
      sender: received[0].sender,
      recipients: received[0].recipients,
      from: headers.get("from"),
      to: headers.get("to"),
      subject: headers.get("subject"),
      contentType: headers.get("content-type"),
      encoding: headers.get("content-transfer-encoding"),
      body,
    },
    {
      sender: "request-service@ordy.test",
      recipients: ["team@ordy.test", "second@ordy.test"],
      from: "=?UTF-8?Q?ordy_=C2=B7_Klinikum_Beispielstadt?= <request-service@ordy.test>",
      to: "eva.brandl@labor-kanal.example",
      subject: "Secure request from Klinikum Beispielstadt",
      contentType: "text/plain; charset=utf-8",
      encoding: "7bit",
      body:
        "Hello,\n\n" +
        "Dr. Lena Hofer at Klinikum Beispielstadt has sent you a secure request.\n" +
        "Open it here: http://localhost:3010/r/5f2c8a91d04e7b36\n\n" +
        "You need ID Austria to open it. The link expires on 5 November 2026.\n" +
        "If you did not expect this message, you can ignore it.\n",
    },
  );
});

test("an email that names the patient never reaches the SMTP server, while the same email without the name does", async (t) => {
  const received = await fakeSmtp(t);
  await assert.rejects(sendRequestEmail({ ...request1, requester: "Dr. Maria Hofer" }), (error) => {
    assert.ok(error instanceof MessageRefused);
    assert.deepEqual(error.categories, ["patient-name"]);
    assert.equal(error.message, "Refused to send the email because it contains patient-name");
    return true;
  });
  assert.equal(received.length, 0);

  await sendRequestEmail(request1);
  assert.deepEqual(
    received.map((email) => parseEmail(email.raw).headers.get("to")),
    ["eva.brandl@labor-kanal.example"],
  );
});
