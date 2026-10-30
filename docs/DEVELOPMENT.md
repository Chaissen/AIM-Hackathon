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

1. installs dependencies, creates `.env` if needed, and generates a private 32-byte random `ORDY_SECRET`; reruns preserve a valid key and replace missing, short, or old demo keys. `.env` is restricted to its owner (mode 0600)
2. generates the Synapse config in `docker/synapse/` once, for the closed server `klinikum.example`
3. starts the containers from `docker-compose.yml` and waits for Synapse, Postgres, HAPI, and Keycloak with the `idaustria-sim` realm (HAPI needs about a minute the first time)
4. registers the Matrix users `@lena.hofer` (Dr. Hofer) and `@ordy` (the bot)
5. runs the database migrations (`pnpm db:migrate`)
6. loads Maria Beispiel from `track/scenario/patient.json` into HAPI (`pnpm fhir:seed`)
7. creates the room `#outside-documents:klinikum.example`, joins Dr. Hofer and the bot, and pins the widget (`pnpm matrix:bootstrap`). Its URL includes the widget ID and its registration sets `waitForIframeLoad: false`, so Element waits for the widget API to be ready before negotiating capabilities

When upgrading an existing installation, run `pnpm matrix:bootstrap` and reload Element to update the pinned widget's authentication handshake.

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
4. Open the ordy widget and approve Element's identity request. The patient list and **Audit log** tab require this Matrix sign-in. Opening `/widget` or `/audit` directly shows sign-in guidance without patient or audit data.
5. Open http://localhost:8080/realms/idaustria-sim/.well-known/openid-configuration. It shows the issuer `http://localhost:8080/realms/idaustria-sim`. This is the simulated ID Austria. Its test logins, such as `eva.brandl` / `demo-eva`, work once the answer portal (T07) exists. Keycloak's account page does not work in this realm, on purpose.

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

Test citizens for the ID Austria login: `eva.brandl` / `demo-eva`, `stefan.kern` / `demo-stefan`, `thomas.wagner` / `demo-thomas`, `anna.huber` / `demo-anna`, and `eva.brandl2` / `demo-eva2`. [Identity and misdelivery](IDENTITY.md#test-citizens) says whom each one plays. There is no sign-up page. `pnpm citizen` adds more people, such as the two senders of the [extra test documents](#extra-test-documents).

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

## Add a UI component

The pages use [shadcn/ui](https://ui.shadcn.com/). The components live in `src/components/ui/` and belong to us, so edit them freely.

```bash
pnpm dlx shadcn@4.22.1 add dialog
```

Pin the CLI version, so it fits the 7-day rule. The UI uses the system font and one accent colour, both set in `src/app/globals.css`. Every page shows the disclaimer from [Compliance and safety](COMPLIANCE_AND_SAFETY.md) through `src/app/layout.tsx`.

Tailwind's class scan is scoped to `src/` with [`source()`](https://tailwindcss.com/docs/detecting-classes-in-source-files#setting-your-base-path) in `globals.css`. Keep UI source files there so Turbopack does not scan generated container data such as Synapse's private signing key.

## Add a bot command

Add an entry to `src/bot/commands.ts`. The command gets a caller that acts as the sender and the text after the command name. Keep the logic in a tRPC procedure. Requests and the decisions about them belong in the widget, not in bot commands. `!help` lists every command automatically.

## Extra test documents

The jury tests with new outside people and new documents in the scenario's Markdown format, some for the wrong patient. Our own set lives in `track/scenario/extra/`, one file per document, in exactly the format of `track/scenario/documents/`. Synthetic data only.

`track/scenario/extra/index.md` has one table row per document:

| Column | Meaning |
|---|---|
| File | The file name, for example `lab-result-maria-beispiel-kidney.md` |
| Kind | `Lab result`, `Rehab report`, or `Other` (any other heading kind, which the parser returns as a generic document) |
| Patient | Name and birth date exactly as the document writes them |
| Sender | The outside person who uploads it |
| Expected | Starts with `Filed`, `Held`, or `Blocked`, then why. `Held` means the answer waits for Dr. Hofer in the widget, for example a document kind the parser cannot map, or a name or release-check hold. |
| Trap | What it tests, for example a double family name, a decimal comma, a unit like `10^12/L`, or a range written as `< 5` |

The set holds at least 3 lab results for Maria with other tests, 2 rehab reports whose stay spans two months, and 3 documents for other patients, one with Maria's family name and a different birth date. The index also lists the 2 extra outside people with double names and the `pnpm citizen` commands that add them. Keycloak keeps them only until the container is recreated, so run the commands again after `./scripts/setup.sh`.

`pnpm test` runs `src/server/documents/extra.test.ts`. It reads the index, runs every file through `parseDocument` and `checkAnswerPatient` with the form filled in from the document, and asserts the kind and the patient. For the outcome it checks only the patient check until the release check (T15) lands: `Filed` and `Held` must pass it, `Blocked` must fail it, and a `Filed` row must not be a generic document, because those are always held. It also asserts the parser values the Trap column names. An expectation the parser does not meet yet is a `todo` test and a row under "Open parser gaps" in the index. It shows up in every run without failing it. Remove the `todo` with the parser fix.

To add a document, write the file, add its row to the index, and run `pnpm test`. If the parser disagrees, decide whether the document, the expectation, or the parser is wrong. Never bend the document to make the test pass.

## Configuration

`src/env.ts` reads configuration with zod. Service addresses and demo accounts have defaults. `ORDY_SECRET` defaults to empty, which disables outside-person session authentication; setup generates a unique private key. Existing installations can run `pnpm exec tsx scripts/init-env.ts` and restart the app to upgrade their key without restarting containers. Changing the key invalidates old outside-person cookies. To add a variable, add it to `src/env.ts` and `.env.example`. [Architecture](ARCHITECTURE.md#configuration) lists all variables.

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
