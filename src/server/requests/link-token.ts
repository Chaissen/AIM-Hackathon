import { createHash, randomBytes } from "node:crypto";

// Link rules from docs/ARCHITECTURE.md, "Link rules": 32 random bytes, URL-safe, only the SHA-256 is stored.
export const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const hashLinkToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function newLinkToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashLinkToken(token) };
}

/** Rejects anything that cannot be a link token before it reaches the database. */
export const isLinkToken = (value: string) => TOKEN.test(value);
