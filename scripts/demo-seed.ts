// pnpm demo:seed [--force]: fills Dr. Hofer's workspace with synthetic requests in every state, through the real code
// paths (docs/DEMO.md, "A populated workspace"). Run `pnpm fhir:seed` first; `pnpm reset` runs it. It refuses to run
// while Dr. Hofer has requests, unless --force adds another set. It needs Postgres, HAPI, Synapse, Keycloak, and the
// eHVD mock, but not the web server or Gmail: the login route handlers run in this process, and it sends no email.
//
// The login route handlers sign their cookies with ORDY_SECRET; ./demo/ordy-secret makes up a key when .env has none.
import "./demo/ordy-secret";

// Imported only now: src/env.ts reads ORDY_SECRET once, when it loads.
await import("./demo/seed");
