import assert from "node:assert/strict";
import { test } from "node:test";

import { env } from "@/env";
import { newLinkToken } from "@/server/requests/link-token";
import { parseEmail, startFakeSmtp } from "./fake-smtp";
import { sendRequestEmail } from "./send";

test("a request email with a real link token reaches the fake SMTP server and gives back the whole link", async (t) => {
  const smtp = await startFakeSmtp();
  const saved = { SMTP_HOST: env.SMTP_HOST, SMTP_PORT: env.SMTP_PORT, SMTP_USER: env.SMTP_USER, MAIL_TEAM_INBOXES: env.MAIL_TEAM_INBOXES };
  Object.assign(env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: smtp.port, SMTP_USER: "", MAIL_TEAM_INBOXES: ["team@ordy.test"] });
  t.after(async () => {
    Object.assign(env, saved);
    await smtp.close();
  });

  // 32 random bytes, 43 characters: the link line is longer than 76 characters, so nodemailer may fold it.
  const link = `http://localhost:3010/r/${newLinkToken().token}`;
  await sendRequestEmail({
    to: "eva.brandl@labor-kanaI.example",
    requester: "Dr. Lena Hofer",
    clinic: "Klinikum Beispielstadt",
    link,
    expiresAt: new Date("2026-11-05T10:00:00+01:00"),
    patient: { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" },
  });

  assert.equal(smtp.received.length, 1);
  assert.deepEqual(smtp.received[0].recipients, ["team@ordy.test"]);
  const { headers, body } = parseEmail(smtp.received[0].raw);
  // Nodemailer writes the domain in lowercase, as domains do not depend on case. The seed compares in lowercase too.
  assert.equal(headers.get("to")?.toLowerCase(), "eva.brandl@labor-kanai.example");
  assert.ok(body.includes(`Open it here: ${link}\n`), "the body holds the link unbroken");
});

test("parseEmail undoes quoted-printable soft line breaks and bytes", () => {
  const raw = ["Content-Transfer-Encoding: quoted-printable", "", "Open it here: http://localhost:3010/r/abc=", "def and =C2=B7 done", ""].join("\r\n");
  assert.equal(parseEmail(raw).body, "Open it here: http://localhost:3010/r/abcdef and · done\n");
});
