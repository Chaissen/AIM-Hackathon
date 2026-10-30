import assert from "node:assert/strict";
import { afterEach, beforeEach, test, type TestContext } from "node:test";

import { env } from "@/env";
import { listInboxEmails } from "./mailpit";

const saved = { MAILPIT_API_URL: env.MAILPIT_API_URL, PUBLIC_URL: env.PUBLIC_URL, SMTP_USER: env.SMTP_USER };
beforeEach(() => Object.assign(env, { MAILPIT_API_URL: "http://mailpit.test", PUBLIC_URL: "http://localhost:3010", SMTP_USER: "" }));
afterEach(() => Object.assign(env, saved));

// Trimmed answers of Mailpit's API, with fields ordy does not read.
const LIST = {
  total: 2,
  count: 2,
  messages: [
    {
      ID: "17mEWvxGE56Fm9RBxLamMz",
      MessageID: "a0ee218d@klinikum.example",
      Read: false,
      From: { Name: "ordy · Klinikum Beispielstadt", Address: "ordy@klinikum.example" },
      To: [{ Name: "", Address: "e.brandl@labor-kanal.example" }],
      Cc: null,
      Subject: "Secure request from Klinikum Beispielstadt",
      Created: "2026-10-30T05:01:41.795Z",
      Size: 920,
      Snippet: "Hello, Dr. Lena Hofer at Klinikum Beispielstadt has sent you a secure request.",
    },
    {
      ID: "6R0GSmkzsSragrasgMbjGl",
      To: null,
      Subject: "Something else",
      Created: "2026-10-30T06:01:41+01:00",
    },
  ],
};
const TEXT = {
  "17mEWvxGE56Fm9RBxLamMz":
    "Hello,\r\n\r\nDr. Lena Hofer at Klinikum Beispielstadt has sent you a secure request.\r\n" +
    "Open it here: http://localhost:3010/r/JLltuYIjceMYxJHomonkfqtNlNTdI_TuH5rlti69sCs\r\n\r\n" +
    "You need ID Austria to open it. The link expires on 5 November 2026.\r\n",
  "6R0GSmkzsSragrasgMbjGl": "Not a portal link: http://evil.example/r/abc or http://localhost:3010/sms\tnor http://localhost:3010/r",
};

function mailpit(t: TestContext) {
  return t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const path = String(url).replace("http://mailpit.test/api/v1/", "");
    if (path === "messages?limit=50") return Response.json(LIST);
    const id = path.replace("message/", "") as keyof typeof TEXT;
    return Object.hasOwn(TEXT, id) ? Response.json({ ID: id, HTML: "", Text: TEXT[id] }) : new Response("not found", { status: 404 });
  });
}

test("lists the emails with their portal links", async (t) => {
  const fetch = mailpit(t);
  assert.deepEqual(await listInboxEmails(), {
    status: "ok",
    emails: [
      {
        id: "17mEWvxGE56Fm9RBxLamMz",
        to: ["e.brandl@labor-kanal.example"],
        subject: "Secure request from Klinikum Beispielstadt",
        at: new Date("2026-10-30T05:01:41.795Z"),
        text:
          "Hello,\n\nDr. Lena Hofer at Klinikum Beispielstadt has sent you a secure request.\n" +
          "Open it here: http://localhost:3010/r/JLltuYIjceMYxJHomonkfqtNlNTdI_TuH5rlti69sCs\n\n" +
          "You need ID Austria to open it. The link expires on 5 November 2026.\n",
        links: ["http://localhost:3010/r/JLltuYIjceMYxJHomonkfqtNlNTdI_TuH5rlti69sCs"],
      },
      {
        id: "6R0GSmkzsSragrasgMbjGl",
        to: [],
        subject: "Something else",
        at: new Date("2026-10-30T05:01:41Z"),
        text: TEXT["6R0GSmkzsSragrasgMbjGl"],
        links: [],
      },
    ],
  });
  assert.equal(fetch.mock.callCount(), 3);
});

test("an answer that is not Mailpit's reads as unreachable", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ messages: [{ ID: 1 }] }));
  assert.deepEqual(await listInboxEmails(), { status: "unreachable" });
});

test("a closed port is unreachable", async () => {
  env.MAILPIT_API_URL = "http://127.0.0.1:9";
  assert.deepEqual(await listInboxEmails(), { status: "unreachable" });
});

test("with SMTP_USER set, Mailpit receives nothing and is not asked", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("Mailpit was asked"));
  env.SMTP_USER = "team@gmail.example";
  assert.deepEqual(await listInboxEmails(), { status: "gmail" });
  assert.equal(fetch.mock.callCount(), 0);
});
