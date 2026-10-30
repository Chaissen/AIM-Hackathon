import { z } from "zod";

export const sessionSecret = z.string().trim().min(32).refine(
  (value) => value !== "change-me-to-a-long-random-string" && value !== "ordy-dev-secret-change-me",
  "Run ./scripts/setup.sh to generate a private ORDY_SECRET",
);

export function sessionKey(secret: string): Uint8Array {
  const parsed = sessionSecret.safeParse(secret);
  if (!parsed.success) throw new Error("A private ORDY_SECRET of at least 32 characters is required. Run ./scripts/setup.sh.");
  return new TextEncoder().encode(parsed.data);
}
