import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { roomReference } from "@/lib/workspace";
import { openWorkspaceSession, sealWorkspaceSession } from "./workspace-session";

const identity = { userId: "@lena.hofer:klinikum.example", accessToken: "private-matrix-access-token", displayName: "Dr. Lena Hofer" };
const at = new Date("2026-10-30T10:00:00Z");
const secret = randomBytes(32).toString("hex");

test("a workspace session encrypts the Matrix credential and enforces its identity, key, integrity and lifetime", async () => {
  const { token, session } = await sealWorkspaceSession(identity, { secret, at, maxAge: 60 });
  assert.deepEqual(session, { ...identity, expiresAt: new Date("2026-10-30T10:01:00Z") });
  assert.deepEqual(await openWorkspaceSession(token, { secret, at }), session);
  assert.equal(token.split(".").length, 5);
  assert.equal(token.includes(identity.accessToken), false);
  const parts = token.split(".");
  const ciphertext = Buffer.from(parts[3], "base64url");
  ciphertext[0] ^= 1;
  parts[3] = ciphertext.toString("base64url");
  assert.equal(await openWorkspaceSession(parts.join("."), { secret, at }), null);
  assert.equal(await openWorkspaceSession(token, { secret: randomBytes(32).toString("hex"), at }), null);
  assert.equal(await openWorkspaceSession(token, { secret, at: new Date("2026-10-30T09:59:59Z") }), null);
  assert.equal(await openWorkspaceSession(token, { secret, at: new Date("2026-10-30T10:01:00Z") }), null);
});

test("session lifetime is capped and a setup placeholder cannot issue credentials", async () => {
  const { session } = await sealWorkspaceSession(identity, { secret, at, maxAge: 24 * 60 * 60 });
  assert.equal(session.expiresAt.toISOString(), "2026-10-30T18:00:00.000Z");
  await assert.rejects(sealWorkspaceSession(identity, { secret: "change-me-to-a-long-random-string", at }), { message: "A private ORDY_SECRET of at least 32 characters is required. Run ./scripts/setup.sh." });
});

test("room references support current opaque IDs, legacy IDs and aliases, but reject missing or malformed references", () => {
  for (const value of ["!a", "!opaque-v12-room", "!legacy:klinikum.example", "#outside-documents:klinikum.example"]) {
    assert.equal(roomReference.parse(value), value);
  }
  for (const value of ["", "room", "!", "#outside-documents", "#:klinikum.example", "!legacy:", "!room name", " !opaque"]) {
    assert.equal(roomReference.safeParse(value).success, false, value);
  }
});
