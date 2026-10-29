# Development

How to set up, start, reset, and extend ordy. [Architecture](ARCHITECTURE.md) explains how the parts fit together.

## Rules

- **Everything is in English**: code, comments, UI text, bot messages, commit messages, pull requests, and docs. Names from the scenario, such as "Klinikum Beispielstadt" or "Labor Kanalstraße", stay as they are.
- Everything we write is TypeScript. Only third-party servers (Synapse, HAPI, Mailpit, Keycloak) and the HL7 validator are not.
- Synthetic data only. No secrets in git: use `.env`, and add a placeholder to `.env.example`.
- New dependencies must have been public for at least 7 days. `minimumReleaseAge` in `pnpm-workspace.yaml` enforces this. Do not lower it.

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Docker with Compose v2 | recent | `docker compose version` |
| Node.js | 22 or newer | `node -v` |
| pnpm | 10 (pinned in `package.json`) | `corepack enable`, then `pnpm -v` |
| Java | 17 or newer, only for the HL7 validator | `java -version` |

These ports must be free: 3010 (ordy), 5433 (Postgres), 8008 (Synapse), 8081 (Element), 8090 (HAPI), 8025 and 1025 (Mailpit), 8080 (Keycloak). The eHVD mock will use 8095 (T23).

## First-time setup

```bash
git clone https://github.com/Chaissen/AIM-Hackathon.git
cd AIM-Hackathon
./scripts/setup.sh
```

`setup.sh` is safe to run again. It:

1. copies `.env.example` to `.env` if there is no `.env`
2. generates the Synapse config in `docker/synapse/` once, for the closed server `klinikum.example`
3. starts the containers from `docker-compose.yml` and waits for Synapse, Postgres, HAPI, and Keycloak with the `idaustria-sim` realm (HAPI needs about a minute the first time)
4. registers the Matrix users `@lena.hofer` (Dr. Hofer) and `@ordy` (the bot)
5. runs `pnpm install`, then the database migrations (`pnpm db:migrate`)
6. loads Maria Beispiel from `track/scenario/patient.json` into HAPI (`pnpm fhir:seed`)
7. creates the room `#outside-documents:klinikum.example`, joins Dr. Hofer and the bot, and pins the widget (`pnpm matrix:bootstrap`)

## Start

```bash
pnpm dev
```

This starts two processes with prefixed logs:

- `[web]` Next.js on http://localhost:3010: pages, route handlers, and the tRPC endpoint `/api/trpc`
- `[bot]` the Matrix bot, which logs `ordy bot running as @ordy:klinikum.example`

Both reload when you save a file. Stop them with Ctrl+C. The containers keep running; `docker compose stop` stops them and `docker compose start` brings them back.

Check that everything works:

1. http://localhost:3010 shows three green dots for database, FHIR server, and Matrix.
2. Open Element at http://localhost:8081, log in as `lena.hofer` / `hofer-demo-2026`, and open "Dr. Hofer · Outside documents".
3. Send `!status`. The bot answers with the same three checks.
4. Open http://localhost:8080/realms/idaustria-sim/.well-known/openid-configuration. It shows the issuer `http://localhost:8080/realms/idaustria-sim`. This is the simulated ID Austria. Its test logins, such as `eva.brandl` / `demo-eva`, work once the answer portal (T07) exists. Keycloak's account page does not work in this realm, on purpose.

| Service | URL | Login |
|---|---|---|
| ordy | http://localhost:3010 | |
| Element | http://localhost:8081 | `lena.hofer` / `hofer-demo-2026` |
| Mailpit | http://localhost:8025 | |
| HAPI FHIR | http://localhost:8090/fhir | |
| Synapse | http://localhost:8008 | bot: `ordy` / `ordy-demo-2026` |
| Postgres | `postgres://ordy:ordy@localhost:5433/ordy` | `ordy` / `ordy` |
| Keycloak (simulated ID Austria) | http://localhost:8080 | `admin` / `keycloak-demo-2026` for the admin console |
| eHVD mock (T23) | http://localhost:8095/ehvd.wsdl | none, IP allowlist as in [eHVD](EHVD.md) |

Test citizens for the ID Austria login: `eva.brandl` / `demo-eva`, `stefan.kern` / `demo-stefan`, `thomas.wagner` / `demo-thomas`, `anna.huber` / `demo-anna`, and `eva.brandl2` / `demo-eva2`. [Identity and misdelivery](IDENTITY.md#test-citizens) says whom each one plays. There is no sign-up page. `pnpm citizen` adds more people.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js and the bot, with reload |
| `pnpm dev:web`, `pnpm dev:bot` | Only one of the two |
| `pnpm build`, then `pnpm start` | Production build, then both processes without reload |
| `pnpm typecheck` | Generates the Next.js route types, then runs `tsc` |
| `pnpm lint` | ESLint |
| `pnpm test` | The `*.test.ts` files under `src/`, with Node's test runner through tsx |
| `pnpm reset` | Empties Postgres, HAPI, and Mailpit, and reloads the patient. Matrix users and the room stay. Run it before every demo. |
| `pnpm db:generate --name <name>` | Writes a SQL migration to `drizzle/` from the schema |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm db:studio` | Opens Drizzle Studio to browse the database |
| `pnpm fhir:seed` | Puts `Patient/maria-beispiel` on HAPI |
| `pnpm matrix:bootstrap` | Creates the room if needed, joins Dr. Hofer and the bot, and pins the widget |
| `pnpm citizen --given Peter --family Muster --birthdate 1970-01-01` | Adds a test citizen to the simulated ID Austria and prints the username, password, bPK, and eHVD OID. [Identity and misdelivery](IDENTITY.md#add-a-test-citizen) lists the options. |
| `./scripts/setup.sh` | Full one-time setup, see above |

Before every push: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Change the database

1. Edit `src/server/db/schema.ts`.
2. `pnpm db:generate --name add-requests` writes a new file to `drizzle/`.
3. `pnpm db:migrate` applies it.
4. Commit the schema change and the migration together. Never edit a migration that is already on `main`; add a new one.

## Add a tRPC procedure

Put it in a router under `src/server/api/routers/` and register the router in `src/server/api/root.ts`. Choose the procedure by who may call it:

| Procedure | Caller | How the caller is recognised |
|---|---|---|
| `publicProcedure` | anyone | nothing |
| `clinicProcedure` | Dr. Hofer and other network members | Matrix OpenID token from the widget (`Authorization: Bearer`), or the bot via `createCaller` |
| `eidProcedure` | the outside person after the ID Austria login | session cookie `ordy_eid_session`, bound to one request |

```ts
// src/server/api/routers/request.ts
import { z } from "zod";
import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";

export const requestRouter = createTRPCRouter({
  cancel: clinicProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ ctx, input }) => {
    // ctx.db is Drizzle, ctx.actor.mxid is the network member
  }),
});
```

Call it from a client component:

```tsx
const trpc = useTRPC();
const cancel = useMutation(trpc.request.cancel.mutationOptions());
```

Call it from a script:

```ts
const caller = createCaller(createContext({ kind: "clinic", mxid: "@lena.hofer:klinikum.example" }));
await caller.request.cancel({ id: 1 });
```

Do not import `server-only` in modules that the bot or the scripts use. It throws outside Next.js.

## Add a bot command

Add an entry to `src/bot/commands.ts`. The command gets a caller that acts as the sender and the text after the command name. Keep the logic in a tRPC procedure. Requests and the decisions about them belong in the widget, not in bot commands. `!help` lists every command automatically.

## Configuration

`src/env.ts` reads and validates every variable with zod. Each one has a demo default, so the stack runs without `.env`. To add a variable, add it to `src/env.ts` with a default and to `.env.example`. [Architecture](ARCHITECTURE.md#configuration) lists all variables.

To open answer links on a phone in the same network, set `PUBLIC_URL` to your computer's LAN address, for example `http://192.168.1.20:3010`, restart `pnpm dev`, and run `pnpm matrix:bootstrap` so the widget uses the new address.

## HL7 validator

The validator is not in git. Download it once:

```bash
mkdir -p tools
curl -L -o tools/validator_cli.jar https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar
java -jar tools/validator_cli.jar some-resource.json -version 4.0
```

It checks LOINC codes against tx.fhir.org, so it needs internet access. `pnpm validate` (T18) will run it on every filed resource.

## Clean slate

`pnpm reset` is enough before a demo. To remove everything, including the Matrix users, the room, and the database volume:

```bash
docker compose down -v
rm -rf docker/synapse/*
./scripts/setup.sh
```

This deletes all local data. Matrix logins in open Element tabs stop working.

## Troubleshooting

| Problem | Fix |
|---|---|
| A port is already in use | Stop the other program, or change the host port in `docker-compose.yml` and the matching URL in `.env` |
| `[bot] ordy bot could not start` | Synapse is not up or the bot user is missing. Run `./scripts/setup.sh`, then `pnpm dev`. |
| The status page shows the FHIR server red | HAPI is still starting. Wait a minute after `docker compose up`. |
| `UNAUTHORIZED` from a clinic procedure | The request has no valid Matrix OpenID token. The widget must get one from Element first. |
| No widget in the room | Run `pnpm matrix:bootstrap`, reload Element, and allow the widget when Element asks |
| Element shows an old room or no room | Log out and in again. The room alias is `#outside-documents:klinikum.example`. |
| Keycloak ignores a change to the realm file | It imports the realm only when it does not exist yet. Run `docker compose up -d --force-recreate keycloak`. This also removes people added with `pnpm citizen`. |
| Strange Next.js errors after switching branches | Stop `pnpm dev`, delete `.next/`, start again |
| `pnpm install` refuses a package | It is younger than 7 days. Pick an older version. |
