// pnpm demo:seed [--force]: fills Dr. Hofer's workspace with synthetic requests in every state, through the real code
// paths (docs/DEMO.md, "A populated workspace"). Run `pnpm fhir:seed` first; `pnpm reset` runs it. It refuses to run
// while Dr. Hofer has requests, unless --force adds another set. It needs Postgres, HAPI, Synapse, Keycloak, and the
// eHVD mock, but not the web server or Mailpit: the login route handlers run in this process, and it sends no email.
//
// The login route handlers sign their cookies with ORDY_SECRET. Without a private one in .env, this run makes up a
// random key for its own process. The cookies never leave the process, so no other server needs it.
import { randomBytes } from "node:crypto";

import { sessionSecret } from "@/server/auth/session-secret";

if (!sessionSecret.safeParse(process.env.ORDY_SECRET ?? "").success) {
  process.env.ORDY_SECRET = randomBytes(32).toString("hex");
  console.log("ORDY_SECRET is not set: this run signs its login cookies with a random key of its own.");
}

// Imported only now: src/env.ts reads ORDY_SECRET once, when it loads.
await import("./demo/seed");
