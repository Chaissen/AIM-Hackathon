# ordy: Track 2, health data interoperability

This is our entry for [Track 2 of the AIM hackathon](https://github.com/AIM-Austria/TRACK-2-interoperability). Dr. Lena Hofer works inside PGK, a closed document network built on Matrix. The service in this repository lets her request a document from someone outside the network, such as a lab or a rehab clinic. The outside person logs in with ID Austria, answers in the browser, and the service files the answer as FHIR R4 on the clinic's FHIR server.

Status: design written; TypeScript stack set up (Next.js, tRPC, Postgres, Matrix bot), features not built yet.

## Documents

| Document | What it covers |
|---|---|
| [Whitepaper](docs/WHITEPAPER.md) | The problem, the solution, our answers to the five design questions, and how we measure the metrics |
| [Development](docs/DEVELOPMENT.md) | Set up, start, reset, and extend the stack; troubleshooting |
| [Architecture](docs/ARCHITECTURE.md) | Components, ports, the request lifecycle, the Matrix bot, messages, parsing, and the audit log |
| [eHVD](docs/EHVD.md) | The real eHVD SOAP interface, what is public about it, our mock, and how ordy uses it |
| [Identity and misdelivery](docs/IDENTITY.md) | Real ID Austria and eHVD, the Keycloak simulation, the identity checks, and the three misdelivery tests |
| [FHIR model](docs/FHIR.md) | The resources we file, how they reference each other, and how we validate them |
| [Timeline](docs/TIMELINE.md) | Milestones, tasks, owners, and the cut list |
| [Compliance and safety](docs/COMPLIANCE_AND_SAFETY.md) | Synthetic data, message rules, data we keep, AI rules, and the disclaimer |
| [UML diagrams](docs/UML.md) | Use cases, domain classes, and component relations |
| [Track brief](track/README.md) and [scenario](track/scenario/README.md) | The task as the organisers wrote it |

## Quick start

Requirements: Docker with Compose v2, Node.js 22 or newer, pnpm 10 (`corepack enable`), and Java 17 or newer for the HL7 validator. [Development](docs/DEVELOPMENT.md) has the full guide.

```bash
./scripts/setup.sh   # once: .env, containers, Matrix users, database, FHIR patient, Matrix room and widget
pnpm dev             # Next.js on http://localhost:3010 and the Matrix bot
```

| What | URL | Login |
|---|---|---|
| ordy status page | http://localhost:3010 | |
| Element (Dr. Hofer) | http://localhost:8081 | `lena.hofer` / `hofer-demo-2026` |
| Mailpit (outside emails) | http://localhost:8025 | |
| HAPI FHIR | http://localhost:8090/fhir | |
| Postgres | `postgres://ordy:ordy@localhost:5433/ordy` | `ordy` / `ordy` |

In Element, open the room "Dr. Hofer · Outside documents". `!help` lists the bot commands and `!status` checks all services.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js (`dev:web`) and the Matrix bot (`dev:bot`), both reload on changes |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` | Checks before every push |
| `pnpm reset` | Empty Postgres, HAPI, and Mailpit, and reload the patient |
| `pnpm db:generate --name <name>` · `pnpm db:migrate` | Create a migration from `src/server/db/schema.ts`, apply it |
| `pnpm db:studio` | Browse the database |
| `pnpm fhir:seed` · `pnpm matrix:bootstrap` | Load the scenario patient; create the room and pin the widget |

## Architecture

```
Element (Dr. Hofer) ──Matrix──▶ Synapse ◀──sync── ordy bot (tsx) ──createCaller──┐
   └─ widget (iframe, React) ──tRPC + Matrix OpenID token────────────────────────┤
Outside person ──email/SMS link──▶ Next.js pages (React) ──tRPC──────────────────┤
                                                                                 ▼
                                          appRouter (tRPC v11, zod) ── Postgres (Drizzle)
                                                                    └─ HAPI FHIR, Mailpit, Synapse
```

| Part | Where | Notes |
|---|---|---|
| Env | `src/env.ts` | zod-validated, demo defaults for everything |
| tRPC | `src/server/api/` | `publicProcedure`, `clinicProcedure` (Matrix OpenID token or bot), `eidProcedure` (eID session cookie) |
| Database | `src/server/db/` | Drizzle schema, migrations in `drizzle/` |
| FHIR | `src/server/fhir/` | typed with `@types/fhir` (R4) |
| Documents | `src/server/documents/` | Markdown parser (markdown-it) and patient check |
| Identity | `src/server/identity/` | name words for the name match and the patient check |
| Matrix | `src/server/matrix/client.ts` | small client-server API client, no E2EE (not required by the track) |
| Bot | `src/bot/` | separate process for `!help` and `!status`. Requests go through the widget. |
| Client | `src/trpc/` | `@trpc/tanstack-react-query`, superjson |
| AI fallback | `src/server/documents/fallback.ts` | optional, off without `ANTHROPIC_API_KEY`. Provider Anthropic, model `claude-opus-5-5` (`AI_FALLBACK_MODEL`), no server-side fallback model, `@anthropic-ai/sdk` 1.1. Synthetic documents only; every answer it reads is held for Dr. Hofer. |

Dependencies must be public for at least 7 days (`minimumReleaseAge` in `pnpm-workspace.yaml`).

Prototype on synthetic data only. Not a medical device. Not for clinical use.
