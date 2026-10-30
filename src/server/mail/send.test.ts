import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";

import { env } from "@/env";
import { MessageRefused, sendRequestEmail } from "./send";

const mailpit = (path: string, init?: RequestInit) => fetch(`${env.MAILPIT_API_URL}/api/v1/${path}`, init);
const reachable =
  !env.SMTP_USER &&
  (await mailpit("info", { signal: AbortSignal.timeout(2000) }).then(
    (res) => res.ok,
    () => false,
  ));
const skip = reachable ? false : `needs Mailpit at ${env.MAILPIT_API_URL} and no SMTP_USER`;

const Search = z.object({ messages: z.array(z.object({ ID: z.string() })) });
const Message = z.object({ To: z.array(z.object({ Address: z.string() })), Subject: z.string(), Text: z.string(), HTML: z.string() });

async function emailsWith(token: string): Promise<string[]> {
  const res = await mailpit(`search?query=${encodeURIComponent(token)}`);
  return Search.parse(await res.json()).messages.map((m) => m.ID);
}

// Without IDs Mailpit deletes every email, so an empty list must never reach it.
async function remove(ids: string[]) {
  if (ids.length) await mailpit("messages", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: ids }) });
}

const request1 = (token: string) => ({
  to: "eva.brandl@labor-kanal.example",
  requester: "Dr. Lena Hofer",
  clinic: "Klinikum Beispielstadt",
  link: `http://localhost:3010/r/${token}`,
  expiresAt: new Date("2026-11-05T10:00:00+01:00"),
  patient: { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" },
});

test("request 1's email arrives in Mailpit as plain text", { skip }, async (t) => {
  const token = randomBytes(16).toString("hex");
  await sendRequestEmail(request1(token));
  const ids = await emailsWith(token);
  t.after(() => remove(ids));

  assert.equal(ids.length, 1);
  const email = Message.parse(await (await mailpit(`message/${ids[0]}`)).json());
  assert.deepEqual(
    { to: email.To.map((a) => a.Address), subject: email.Subject, text: email.Text.replaceAll("\r\n", "\n"), html: email.HTML },
    {
      to: ["eva.brandl@labor-kanal.example"],
      subject: "Secure request from Klinikum Beispielstadt",
      text:
        "Hello,\n\n" +
        "Dr. Lena Hofer at Klinikum Beispielstadt has sent you a secure request.\n" +
        `Open it here: http://localhost:3010/r/${token}\n\n` +
        "You need ID Austria to open it. The link expires on 5 November 2026.\n" +
        "If you did not expect this message, you can ignore it.\n",
      html: "",
    },
  );
});

test("an email that names the patient never reaches Mailpit, while the same email without the name does", { skip }, async (t) => {
  const token = randomBytes(16).toString("hex");
  await assert.rejects(sendRequestEmail({ ...request1(token), requester: "Dr. Maria Hofer" }), (error) => {
    assert.ok(error instanceof MessageRefused);
    assert.deepEqual(error.categories, ["patient-name"]);
    assert.equal(error.message, "Refused to send the email because it contains patient-name");
    return true;
  });
  assert.deepEqual(await emailsWith(token), []);

  await sendRequestEmail(request1(token));
  const ids = await emailsWith(token);
  t.after(() => remove(ids));
  assert.equal(ids.length, 1);
});
