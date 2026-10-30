// For the scripts that run the login route handlers in their own process: `pnpm demo:seed` and `pnpm scenario`.
// The handlers sign their cookies with ORDY_SECRET. Without a private one in .env, this makes up a random key for the
// script's own process. The cookies never leave the process, so no other server needs it.
//
// Import it before anything that loads src/env.ts, which reads ORDY_SECRET once, when it loads. It imports nothing
// that does.
import { randomBytes } from "node:crypto";

import { sessionSecret } from "@/server/auth/session-secret";

if (!sessionSecret.safeParse(process.env.ORDY_SECRET ?? "").success) {
  process.env.ORDY_SECRET = randomBytes(32).toString("hex");
  console.log("ORDY_SECRET is not set: this run signs its login cookies with a random key of its own.");
}
