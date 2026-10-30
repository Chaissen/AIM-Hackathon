import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { env } from "@/env";
import { parseEmail, type ReceivedEmail, startFakeSmtp } from "./fake-smtp";
import { MessageRefused, sendRequestEmail } from "./send";

/** An SMTP server on 127.0.0.1 for this test. `env` sends to it, never to Mailpit, until the test ends. */
async function fakeSmtp(t: TestContext): Promise<ReceivedEmail[]> {
  const smtp = await startFakeSmtp();
  const saved = { SMTP_HOST: env.SMTP_HOST, SMTP_PORT: env.SMTP_PORT, MAIL_FROM: env.MAIL_FROM };
  Object.assign(env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: smtp.port, MAIL_FROM: "ordy · Klinikum Beispielstadt <request-service@ordy.test>" });
  t.after(async () => {
    Object.assign(env, saved);
    await smtp.close();
  });
  return smtp.received;
}

const request1 = {
  to: "eva.brandl@labor-kanal.example",
  requester: "Dr. Lena Hofer",
  clinic: "Klinikum Beispielstadt",
  link: "http://localhost:3010/r/5f2c8a91d04e7b36",
  expiresAt: new Date("2026-11-05T10:00:00+01:00"),
  patient: { family: "Beispiel", given: ["Maria"], birthDate: "1961-03-12" },
};

test("request 1's email goes to Dr. Brandl as plain text", async (t) => {
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
      recipients: ["eva.brandl@labor-kanal.example"],
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
    assert.equal(error.message, "Refused to send the message because it contains patient-name");
    return true;
  });
  assert.equal(received.length, 0);

  await sendRequestEmail(request1);
  assert.deepEqual(
    received.map((email) => parseEmail(email.raw).headers.get("to")),
    ["eva.brandl@labor-kanal.example"],
  );
});
