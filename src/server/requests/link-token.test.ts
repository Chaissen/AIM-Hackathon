import assert from "node:assert/strict";
import { test } from "node:test";

import { hashLinkToken, isLinkToken, newLinkToken } from "./link-token";

test("a link token is 32 random bytes, URL-safe, and stored only as its SHA-256", () => {
  const { token, hash } = newLinkToken();
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(encodeURIComponent(token), token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashLinkToken(token));
  assert.notEqual(hash, token);
});

test("every link token is new", () => {
  const tokens = new Set(Array.from({ length: 100 }, () => newLinkToken().token));
  assert.equal(tokens.size, 100);
});

test("isLinkToken accepts only the token shape", () => {
  assert.equal(isLinkToken(newLinkToken().token), true);
  for (const value of ["", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`]) {
    assert.equal(isLinkToken(value), false, JSON.stringify(value));
  }
});
