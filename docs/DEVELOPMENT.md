# Development

How to set up, start, reset, and extend ordy. [Architecture](ARCHITECTURE.md) explains how the parts fit together. [Deployment](DEPLOYMENT.md) covers the public workspace hostname and migration from Element.

## Rules

- **Everything is in English**: code, comments, UI text, bot messages, commit messages, pull requests, and docs. Names from the scenario, such as "Klinikum Beispielstadt" or "Labor Kanalstraße", stay as they are.
- Everything we write is TypeScript. Only third-party servers (Synapse, HAPI, Mailpit, Keycloak) and the HL7 validator are not.
- Synthetic data only. No secrets in git: use `.env`, and add a placeholder to `.env.example`.
- New dependencies must have been public for at least 7 days. `minimumReleaseAge` in `pnpm-workspace.yaml` enforces this. Do not lower it.
- Clinical rules that wait for a clinician's decision are marked "pending clinical sign-off". Their questions are in [`clinical-review/`](clinical-review/README.md). Do not change such a rule before its review file is signed.

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Docker with Compose v2 | recent | `docker compose version` |
| Node.js | 22 or newer | `node -v` |
| pnpm | 10 (pinned in `package.json`) | `corepack enable`, then `pnpm -v` |
| Java | 17 or newer, only for the HL7 validator | `java -version` |

Port 8082 is needed only for optional Element compatibility. These ports must be free: 3010 (ordy), 5433 (Postgres), 8008 (Synapse), 8081 (workspace gateway), 8090 (HAPI), 8025 and 1025 (Mailpit), 8080 (Keycloak), 8095 (eHVD mock).

## First-time setup

```bash
git clone https://github.com/Chaissen/AIM-Hackathon.git
cd AIM-Hackathon
./scripts/setup.sh
```

`setup.sh` is safe to run again. It:

1. installs dependencies, creates `.env` if needed, and generates a private 32-byte random `ORDY_SECRET`; reruns preserve a valid key and replace missing, short, or old demo keys. `.env` is restricted to its owner (mode 0600)
2. generates the Synapse config in `docker/synapse/` once, for the closed server `klinikum.example`
3. builds the eHVD mock image and starts the containers from `docker-compose.yml`. It then waits for Synapse, Postgres, HAPI, Keycloak with the `idaustria-sim` realm, and the eHVD mock. HAPI needs about a minute the first time.
4. registers the Matrix users `@lena.hofer` (Dr. Hofer) and `@ordy` (the bot)
5. runs the database migrations (`pnpm db:migrate`)
6. loads Maria Beispiel from `track/scenario/patient.json` into HAPI (`pnpm fhir:seed`)
7. creates the room `#outside-documents:klinikum.example`, joins Dr. Hofer and the bot, sets her display name to "Dr. Lena Hofer", and pins the widget (`pnpm matrix:bootstrap`). Its URL includes the widget ID and its registration sets `waitForIframeLoad: false`, so Element waits for the widget API to be ready before negotiating capabilities

For an existing installation that serves Element on 8081, follow [the workspace migration](DEPLOYMENT.md#migrate-an-existing-element-entry) before starting the new gateway. The optional legacy widget still uses `pnpm matrix:bootstrap` to update its authentication handshake.

## Start

```bash
pnpm dev
```

This starts two processes with prefixed logs:

- `[web]` Next.js on http://localhost:3010: pages, route handlers, and the tRPC endpoint `/api/trpc`
- `[bot]` the Matrix bot, which logs `ordy bot running as @ordy:klinikum.example`

Both reload when you save a file. Stop them with Ctrl+C. The containers keep running; `docker compose stop` stops them and `docker compose start` brings them back.

Check that everything works:

1. Open http://localhost:8081 and sign in to the ordy workspace as `lena.hofer` / `hofer-demo-2026`. The same workspace is available directly at http://localhost:3010.
2. Open **Messages** and select "Dr. Hofer · Outside documents". Send `!status` to check the database, FHIR server, and Matrix through the bot.
3. Use the workspace navigation for Overview, Requests, New request, Patients, Contacts, Audit log, and Metrics. These views use the same authenticated procedures and ownership rules as the optional widget. Every view has a hash route, such as `#/requests` or `#/messages`, which [Architecture](ARCHITECTURE.md#views-and-hash-routes) lists.
4. http://localhost:3010/api/healthz returns the database, FHIR, and Matrix health checks.
5. Open http://localhost:8080/realms/idaustria-sim/.well-known/openid-configuration. It shows the issuer `http://localhost:8080/realms/idaustria-sim`. This is the simulated ID Austria. Its test logins, such as `eva.brandl` / `demo-eva`, work from a request link. Keycloak's account page does not work in this realm, on purpose.
6. Open http://localhost:8095/healthz. It shows `{"status":"ok","entries":313}`. This is the eHVD mock, and [eHVD](EHVD.md#trigger-each-fault) shows how to call it.

| Service | URL | Login |
|---|---|---|
| ordy workspace through its gateway | http://localhost:8081 | `lena.hofer` / `hofer-demo-2026` |
| ordy Next.js app, including workspace and outside portal | http://localhost:3010 | the same network account for the workspace |
| Optional Element compatibility client | http://localhost:8082 | the same Matrix account; enable the `legacy-element` profile |
| Mailpit | http://localhost:8025 | |
| Recipient's inbox: the emails in Mailpit and the SMS screen, with each portal link | http://localhost:3010/inbox | none. Demo only. A production build answers 404. |
| HAPI FHIR | http://localhost:8090/fhir | |
| Synapse | http://localhost:8008 | bot: `ordy` / `ordy-demo-2026` |
| Postgres | `postgres://ordy:ordy@localhost:5433/ordy` | `ordy` / `ordy` |
| Keycloak (simulated ID Austria) | http://localhost:8080 | `admin` / `keycloak-demo-2026` for the admin console |
| eHVD mock | http://localhost:8095/ehvd.wsdl | none. Loopback and private networks get through, see [eHVD](EHVD.md#configuration). |

`WORKSPACE_URL` defaults to `http://localhost:8081`; `PUBLIC_URL` remains the outside-link base at `http://localhost:3010`. The session endpoint permits their exact origins. Change both deliberately when using another host or port. The gateway's `ORDY_WEB_UPSTREAM` defaults to `host.docker.internal:3010` and can name a web service in a production Docker network. [Deployment](DEPLOYMENT.md) gives the hostname and HTTPS settings.

For the optional Element client, run `docker compose --profile legacy-element up -d element` and open http://localhost:8082. The legacy `/widget` still needs Element's identity approval. It is not the primary app.

Test citizens for the ID Austria login: `eva.brandl` / `demo-eva`, `stefan.kern` / `demo-stefan`, `thomas.wagner` / `demo-thomas`, `anna.huber` / `demo-anna`, and `eva.brandl2` / `demo-eva2`. [Identity and misdelivery](IDENTITY.md#test-citizens) says whom each one plays. There is no sign-up page. `pnpm citizen` adds more people, such as the two senders of the [extra test documents](#extra-test-documents).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js and the bot, with reload |
| `pnpm dev:web`, `pnpm dev:bot` | Only one of the two |
| `pnpm build`, then `pnpm start` | Production build, then both processes without reload |
| `pnpm typecheck` | Generates the Next.js route types, then runs `tsc` on ordy and on the eHVD mock |
| `pnpm lint` | ESLint |
| `pnpm test` | The `*.test.ts` files under `src/` and `services/`, with Node's test runner through tsx. The request tests use the Postgres and FHIR server at the default addresses from `src/env.ts`, because `pnpm test` does not read `.env`. They delete their rows afterwards and are skipped when the servers are not running. Request ids still move on, so run `pnpm reset` before a demo. The mail tests send request 1's email to Mailpit and read it back. They are skipped when Mailpit is not running or `SMTP_USER` is set. The request tests send no email. |
| `pnpm reset` | Empties Postgres, HAPI, and Mailpit, and reloads the patient. Matrix users and the room stay. Run it before every demo. |
| `pnpm db:generate --name <name>` | Writes a SQL migration to `drizzle/` from the schema |
| `pnpm db:migrate` | Applies pending migrations |
| `pnpm db:studio` | Opens Drizzle Studio to browse the database |
| `pnpm fhir:seed` | Puts `Patient/maria-beispiel` on HAPI |
| `pnpm matrix:bootstrap` | Creates the room if needed, joins Dr. Hofer and the bot, sets her display name, and pins the widget |
| `pnpm citizen --given Peter --family Muster --birthdate 1970-01-01` | Adds a test citizen to the simulated ID Austria and prints the username, password, bPK, and eHVD OID. [Identity and misdelivery](IDENTITY.md#add-a-test-citizen) lists the options. |
| `pnpm validate` | Runs the HL7 validator on every resource named in an `answer_filed` entry and counts the errors. `--since <time>` takes only the entries from that time on. `pnpm validate <file or folder>` checks hand-made resources instead. Needs Java. [FHIR](FHIR.md#validation) has the details. |
| `pnpm audit:check` | Lists the six audit event types per request, each with who, what, and when. `--request <id>` checks one request. `--effort` prints the audit timeline and the effort in seconds of the newest request 1, or of `--request <id>`, for the [timed test](clinical-review/TIMED_TEST_20.md). |
| `pnpm scenario` | Runs request 1, M1 to M3, and request 2 against the running stack and writes the four metric results to `out/metrics/metrics.md`. `--no-validate` skips the validator. [Whitepaper](WHITEPAPER.md#how-we-measure-the-metrics) has the details. |
| `pnpm clinical-review:export` | Writes the transaction Bundle ordy would file for each scenario and extra document to `docs/clinical-review/19-fhir/`, without any server. Run it after a change to the parser, the mappers, or the filing, and compare. [Review 19](clinical-review/REVIEW_19_FHIR_DATA.md) has the details. |
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
| `clinicProcedure` | Dr. Hofer and other network members | verified encrypted workspace session with `x-ordy-workspace: 1`, a legacy widget Matrix OpenID token, or the bot via `createCaller` |
| `workspaceProcedure` | signed-in workspace members, for chat | as `clinicProcedure`, plus the user's server-only Matrix client from a workspace session |
| `eidProcedure` | the outside person after the ID Austria login | session cookie `ordy_eid_session`, bound to one request |
| `ownRequestProcedure` (`src/server/api/own-request.ts`) | the network member who sent the request, for data about one request | as `clinicProcedure`, and the input `{ id }` must name a request they sent. Any other id answers `NOT_FOUND`. The handler gets the row as `ctx.request`. |

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

The pages use [shadcn/ui](https://ui.shadcn.com/). Every component in the shadcn 4.22.1 registry is already installed in `src/components/ui/`. They belong to us, so edit them freely. To add one that a later registry gains:

```bash
pnpm dlx shadcn@4.22.1 add <name>
```

Pin the CLI version, so it fits the 7-day rule. `Tooltip` needs a `TooltipProvider` above it, and the sidebar needs a `SidebarProvider`. A `cva` variant object that other files import lives in a `<name>-variants.ts` file next to its component (for example `toggle-variants.ts`), so a component file exports only components and Fast Refresh keeps working.

The visual system follows hex.tech: a paper background with grain, side rails with hatched margins, square hairline components, eggplant text and a rose accent. Every colour, border, radius, shadow and font is a CSS custom property in `src/app/globals.css` (`:root` for light, `.dark` for dark), mapped into Tailwind by `@theme inline`, so a token change restyles every component. The same file holds the textures (`hatch`, `hero-grid`, `dot-grid`, `crop-marks`) and the `eyebrow` label style. The primary button is a solid eggplant fill (`--primary`), not Hex's framed rose button. Fonts come from `next/font/google` in `src/app/layout.tsx`, self-hosted at build time so the browser never calls Google: Archivo (headings, width axis 112% to 125%), Newsreader italic (display accents), Geist (body) and IBM Plex Mono (labels, code). `/styleguide` renders every component and the app's own building blocks with fixture data; it returns 404 in production. Every page shows the disclaimer from [Compliance and safety](COMPLIANCE_AND_SAFETY.md) through `src/app/layout.tsx`.

`/styleguide/widget` renders the whole widget with fixture data at any window size. It needs no Element, Postgres, HAPI, or eHVD. `?fixtures=seeded` (the default), `empty`, or `failing` picks the data. The fixtures live in `src/app/styleguide/widget/fixtures/<router>.ts`, one file for each router the widget calls. Every procedure of those routers needs a fixture, typed with the procedure's real output, so a new query or a changed output fails `pnpm typecheck` until its fixture follows. Like `/styleguide`, it returns 404 in production.

Tailwind's class scan is scoped to `src/` with [`source()`](https://tailwindcss.com/docs/detecting-classes-in-source-files#setting-your-base-path) in `globals.css`. Keep UI source files there so Turbopack does not scan generated container data such as Synapse's private signing key.

## Add a bot command

Add an entry to `src/bot/commands.ts`. The command gets a caller that acts as the sender and the text after the command name. Keep the logic in a tRPC procedure. Requests and the decisions about them belong in the workspace, not in bot commands. `!help` lists every command automatically.

## Extra test documents

The jury tests with new outside people and new documents in the scenario's Markdown format, some for the wrong patient. Our own set lives in `track/scenario/extra/`, one file per document, in exactly the format of `track/scenario/documents/`. Synthetic data only.

`track/scenario/extra/index.md` has one table row per document:

| Column | Meaning |
|---|---|
| File | The file name, for example `lab-result-maria-beispiel-kidney.md` |
| Kind | `Lab result`, `Rehab report`, or `Other` (any other heading kind, which the parser returns as a generic document) |
| Patient | Name and birth date exactly as the document writes them |
| Sender | The outside person who uploads it |
| Expected | Starts with `Filed`, `Held`, or `Blocked`, then why. `Held` means the answer waits for Dr. Hofer in the workspace after a release-check hold. A document kind the parser cannot map is a generic document, and the answer flow refuses it, because a request asks only for a lab result or a discharge report. |
| Trap | What it tests, for example a double family name, a decimal comma, a unit like `10^12/L`, or a range written as `< 5` |

The set holds at least 3 lab results for Maria with other tests, 2 rehab reports whose stay spans two months, and 3 documents for other patients, one with Maria's family name and a different birth date. The index also lists the 2 extra outside people with double names and the `pnpm citizen` commands that add them. Keycloak keeps them only until the container is recreated, so run the commands again after `./scripts/setup.sh`.

`pnpm test` runs `src/server/documents/extra.test.ts`. It reads the index, runs every file through `parseDocument` and `checkAnswerPatient` with the form filled in from the document, and asserts the kind and the patient. For the outcome it checks the patient check: `Filed` and `Held` must pass it, `Blocked` must fail it, and a `Filed` row must not be a generic document, because the answer flow refuses those. It also asserts the parser values the Trap column names. An expectation the parser does not meet yet is a `todo` test and a row under "Open parser gaps" in the index. It shows up in every run without failing it. Remove the `todo` with the parser fix. `src/server/ehvd/release-check.test.ts` checks the release check for the filed documents against the eHVD mock.

To add a document, write the file, add its row to the index, and run `pnpm test`. If the parser disagrees, decide whether the document, the expectation, or the parser is wrong. Never bend the document to make the test pass.

## Configuration

`src/env.ts` reads configuration with zod. Service addresses and demo accounts have defaults. `ORDY_SECRET` defaults to empty, which disables outside-person session authentication; setup generates a unique private key. Existing installations can run `pnpm exec tsx scripts/init-env.ts` and restart the app to upgrade their key without restarting containers. Changing the key invalidates old outside-person cookies. To add a variable, add it to `src/env.ts` and `.env.example`. The eHVD mock's `EHVD_ALLOWLIST` and `EHVD_SCHEMA_ERRORS` are read only by its container, so they live in `docker-compose.yml` and `.env.example`, not in `src/env.ts`. [Architecture](ARCHITECTURE.md#configuration) lists all variables.

To open answer links on a phone in the same network, set `PUBLIC_URL` to your computer's LAN address, for example `http://192.168.1.20:3010`, restart `pnpm dev`, and run `pnpm matrix:bootstrap` so the widget uses the new address.

## Send email through Gmail

Locally every email lands in Mailpit at http://localhost:8025, whatever the address. To send through Gmail instead, as ordysoftware@gmail.com:

1. Get the app password of ordysoftware@gmail.com from the team. Google issues app passwords under Google Account, Security, App passwords, for accounts with 2-Step Verification. The account password does not work over SMTP.
2. Add these lines to `.env`. Never put the app password into git, `.env.example`, or the docs.

   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=ordysoftware@gmail.com
   SMTP_PASSWORD=<Gmail app password>
   MAIL_FROM="ordy · Klinikum Beispielstadt <ordysoftware@gmail.com>"
   MAIL_TEAM_INBOXES=first@example.com,second@example.com
   ```

   Write the app password without its spaces. `setup.sh` reads `.env` with bash, so a value with spaces or `<` needs double quotes, as `MAIL_FROM` has. Gmail replaces a sender address that is not the account's own, so `MAIL_FROM` names the account.
3. Restart `pnpm dev`.

Every email then lands in the team inboxes and in the Sent folder of the account. Its `To` header still names the request's address, for example `eva.brandl@labor-kanal.example`, and Mailpit gets nothing. Without `MAIL_TEAM_INBOXES`, every send fails with "SMTP_USER is set but MAIL_TEAM_INBOXES is empty". To go back to Mailpit, remove the lines. `pnpm test` does not read `.env`. The mail tests skip themselves when `SMTP_USER` is set in the shell, so they never send through Gmail.

## HL7 validator

The validator is not in git. We pin version 7.0.3. `pnpm validate` downloads it to `tools/` when it is missing, and it runs the jar only if its SHA-256 is `57aa43fb40cec5de41def81c927725fd85908eeb71509b7f9313e04d9b8ec79b` (`VALIDATOR_SHA256` in `src/server/metrics/validator.ts`). To download it by hand:

```bash
mkdir -p tools
curl -L -o tools/validator_cli.jar https://github.com/hapifhir/org.hl7.fhir.core/releases/download/7.0.3/validator_cli.jar
sha256sum tools/validator_cli.jar
java -jar tools/validator_cli.jar some-resource.json -version 4.0
```

A jar with another hash, such as one from `releases/latest`, makes `pnpm validate` stop; delete it and run again. To update the validator, change the version, URL, and hash in `validator.ts` and here, and check the vital sign list in `src/server/documents/vital-signs.ts` against the new version ([FHIR](FHIR.md#validation)). It checks LOINC codes against tx.fhir.org, so it needs internet access. `pnpm validate` runs it on every filed resource, and `pnpm validate <file>` on a hand-made one. The first run takes a few minutes, because the validator downloads the FHIR packages to `~/.fhir`.

## Clean slate

`pnpm reset` is enough before a demo. To remove everything, including the Matrix users, the room, and the database volume:

```bash
docker compose down -v
rm -rf docker/synapse/*
./scripts/setup.sh
```

This deletes all local data. Workspace and optional Element sessions stop working.

## Troubleshooting

| Problem | Fix |
|---|---|
| A port is already in use | Stop the other program, or change the host port in `docker-compose.yml` and the matching URL in `.env` |
| `[bot] ordy bot could not start` | Synapse is not up or the bot user is missing. Run `./scripts/setup.sh`, then `pnpm dev`. |
| The health check reports FHIR unavailable | HAPI is still starting. Wait a minute after `docker compose up`. |
| `UNAUTHORIZED` from a clinic procedure | Sign in to the workspace again. A legacy widget must obtain a valid Matrix OpenID token from Element. |
| The workspace gateway returns 502 | Start the Next.js web process on the gateway's configured upstream, normally host port 3010. |
| Workspace sign-in returns 403 for the origin | Set `WORKSPACE_URL` to the exact browser origin, including its port, and restart Next.js. |
| Port 8081 is still held by Element after an upgrade | Stop the old Element service as described in [Deployment](DEPLOYMENT.md#migrate-an-existing-element-entry), then start `workspace`. |
| No widget in the room | Run `pnpm matrix:bootstrap`, reload Element, and allow the widget when Element asks |
| Element shows an old room or no room | Log out and in again. The room alias is `#outside-documents:klinikum.example`. |
| Keycloak ignores a change to the realm file | It imports the realm only when it does not exist yet. Run `docker compose up -d --force-recreate keycloak`. This also removes people added with `pnpm citizen`. |
| The eHVD mock answers every request with an empty HTTP 403 | Either the client address is outside `EHVD_ALLOWLIST`, or the request breaks SOAP 1.2 or the WSDL. `docker compose logs ehvd` shows the client address. With `EHVD_SCHEMA_ERRORS=fault-6001` in `.env` and `docker compose up -d ehvd`, a broken request gets fault 6001 instead. |
| A change under `services/ehvd-mock/` does not show up | The container runs the image built earlier. Run `docker compose up -d --build ehvd`. |
| Strange Next.js errors after switching branches | Stop `pnpm dev`, delete `.next/`, start again |
| `pnpm install` refuses a package | It is younger than 7 days. Pick an older version. |
