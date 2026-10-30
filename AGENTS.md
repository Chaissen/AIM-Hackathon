<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## ordy project notes

- **Everything in English.** Code, comments, UI text, bot and Matrix messages, emails, SMS, commit messages, pull requests, and docs. Never commit German text. Scenario names such as "Klinikum Beispielstadt" or "Labor Kanalstraße" stay as they are. This holds even when the user writes to you in German.
- Stack: Next.js 16 (App Router, Cache Components on) + tRPC v11 + zod + Drizzle on Postgres, pnpm. Everything we write is TypeScript.
- The Matrix bot is a separate process (`src/bot/main.ts`, run with tsx). It calls the tRPC router in-process via `createCaller(createContext(actor))`. Do not import `server-only` in modules the bot or scripts use.
- Matrix access goes through `src/server/matrix/client.ts` (plain fetch, no E2EE). `matrix-bot-sdk` was dropped because it needs a native crypto binary.
- Env: add new variables to `src/env.ts` (zod, with a demo default) and `.env.example`.
- Ports: Next.js 3010, Postgres 5433, Synapse 8008, ordy workspace gateway 8081, optional Element 8082, HAPI 8090, Keycloak 8080, eHVD mock 8095.
- Setup and start: `./scripts/setup.sh` once, then `pnpm dev`. `pnpm reset` empties Postgres and HAPI. `!status` in the Matrix room checks DB, FHIR, and Matrix.
- Verify before handing back: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- New dependencies must be at least 7 days old (`minimumReleaseAge` in `pnpm-workspace.yaml`); do not lower it.
- `docs/` is the single source of truth (start with `DEVELOPMENT.md` and `ARCHITECTURE.md`). Read the relevant doc before you build, and update it in the same change when you change the stack, ports, commands, env variables, data, or a design decision.
- eHVD: follow `docs/EHVD.md`. The real WSDL is `docs/ehvd/eHVD.wsdl`; follow it, not the handbook's method names. The synthetic OIDs listed there are fixed and shared by the eHVD mock, Keycloak, and the FHIR identifiers.
- Track data lives in `track/` (copy of the official repo, including `track/scenario/documents/`). Synthetic data only.
