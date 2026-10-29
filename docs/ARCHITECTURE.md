# Architecture

This page describes what runs, how the parts talk, and what the request service stores. [Whitepaper](WHITEPAPER.md) explains why.

## Components

| Component | What it does | Built or reused | Image or library | Port |
|---|---|---|---|---|
| Synapse | Matrix homeserver for `klinikum.example` | Reused | [`matrixdotorg/synapse`](https://hub.docker.com/r/matrixdotorg/synapse) | 8008 |
| Element Web | Dr. Hofer's chat client | Reused | [`vectorim/element-web`](https://hub.docker.com/r/vectorim/element-web) | 8081 |
| Request service (ordy) | Outside portal, widget, identity checks, parser, FHIR mapper, audit log, SMS screen | Built | TypeScript: [Next.js](https://nextjs.org/docs) 16 (App Router), [tRPC](https://trpc.io/docs) v11, [zod](https://zod.dev/), [Drizzle](https://orm.drizzle.team/), [openid-client](https://github.com/panva/openid-client) (T07), [markdown-it](https://github.com/markdown-it/markdown-it) (T10), UI with [shadcn/ui](https://ui.shadcn.com/) on Tailwind CSS | 3010 |
| Matrix bot | Notices and `!status` in Dr. Hofer's room | Built | TypeScript process in `src/bot/`, small Matrix client on `fetch` in `src/server/matrix/client.ts` | none |
| Postgres | Requests, bindings, audit log | Reused | [`postgres:17-alpine`](https://hub.docker.com/_/postgres) | 5433, mapped to 5432 in the container |
| Simulated ID Austria | OpenID Connect login with fake citizens | Configured (T02) | [Keycloak](https://www.keycloak.org/server/containers) | 8080 |
| eHVD mock | Directory of healthcare people and organisations, same SOAP interface as the real eHVD | Built (T23, planned) | TypeScript service in its own container, see [eHVD](EHVD.md) | 8095 |
| Mailpit | Catches every outgoing email | Reused | [`axllent/mailpit`](https://hub.docker.com/r/axllent/mailpit) | 1025 SMTP, 8025 web |
| HAPI FHIR | FHIR R4 server | Reused | [`hapiproject/hapi`](https://hub.docker.com/r/hapiproject/hapi) | 8090, mapped to 8080 in the container |
| HL7 validator | Validates every filed resource | Reused | [`validator_cli.jar`](https://github.com/hapifhir/org.hl7.fhir.core/releases) | none |

The Matrix bot runs as a second Node.js process next to Next.js, because Next.js does not keep a long-running sync loop. `pnpm dev` starts both. The bot calls tRPC procedures through `createCaller`, inside its own process, so there is no internal HTTP API. Both processes share the Postgres database.

Every reused part can be replaced. Synapse can be any Matrix homeserver, Keycloak can be real ID Austria or another OpenID Connect provider, the eHVD mock can be the real eHVD web service, Mailpit can be any SMTP server, and HAPI can be any FHIR R4 server.

```
 Dr. Hofer                                               Outside person
 Element Web                                             browser
     |                                                      |   |
     v                                                      |   | login
  Synapse <---- ordy bot (Node.js) --+                      |   v
     |                    createCaller   |                      |  Keycloak (simulated ID Austria)
     +-- widget (iframe) ---tRPC--> Request service <-----------+   |
                              (Next.js + tRPC router)              |
                               |   |   |   |   <-- signed token-+
                               |   |   |   +--> HAPI FHIR
                               |   |   +------> Postgres: requests, bindings, audit log
                               |   +----------> eHVD mock (SOAP 1.2)
                               +--------------> Mailpit (email), /sms page (SMS)
```

## Document types

One table in the request service defines each document type. To add a type, add a row.

| Key | Default channel | eHVD check | Mapper | Name in Matrix messages |
|---|---|---|---|---|
| `lab-result` | email | Release check: the physician under `Validated by` is active, has the lab medicine specialty, and is a member of the named organisation | Lab mapper: Observations and DiagnosticReport | lab result |
| `rehab-report` | SMS | Release check: the physician under `Written by` is active and a member of the named organisation, which is an active hospital | Rehab mapper: DocumentReference | rehab discharge report |

## Request lifecycle

The request service stores each request with one state. The FHIR Task for the request mirrors the state.

| State | Meaning | Task status |
|---|---|---|
| `awaiting_confirmation` | The address check failed and Dr. Hofer has not confirmed yet | `draft` |
| `sent` | The email or SMS went out | `requested` |
| `identity_held` | The name matched only partly, and Dr. Hofer decides | `on-hold` |
| `verified` | The identity check passed, and the outside person can answer | `in-progress` |
| `answer_held` | The answer arrived, but the eHVD could not confirm the role, and Dr. Hofer decides | `on-hold` |
| `filed` | The answer is on the FHIR server | `completed` |
| `cancelled` | Dr. Hofer cancelled the request | `cancelled` |
| `expired` | Nobody answered within 7 days | `failed` |
| `locked` | Three identity checks failed on this link | `failed` |

| Event | From | To |
|---|---|---|
| Dr. Hofer sends the request form and the address check passes | none | `sent` |
| Dr. Hofer sends the request form and the address check fails | none | `awaiting_confirmation` |
| Dr. Hofer clicks **Send anyway** | `awaiting_confirmation` | `sent` |
| Identity check passes | `sent` | `verified` |
| Identity check matches the name partly | `sent` | `identity_held` |
| Identity check fails for the third time | `sent` | `locked` |
| Dr. Hofer clicks **Accept** | `identity_held` | `verified` |
| Answer passes the patient check and the role is confirmed | `verified` | `filed` |
| Answer passes the patient check and the role is not confirmed | `verified` | `answer_held` |
| Answer fails the patient check | `verified` | `verified` |
| Dr. Hofer clicks **Accept** | `answer_held` | `filed` |
| Dr. Hofer clicks **Reject** | `identity_held` or `answer_held` | `cancelled` |
| Dr. Hofer clicks **Cancel** | any open state | `cancelled` |
| 7 days pass | any open state | `expired` |

A failed identity check does not change the state, so the real person can still answer a forwarded link. The failure goes to the audit log and to Dr. Hofer.

## Link rules

- The link token is 32 random bytes, encoded URL-safe. The database stores only its SHA-256 hash.
- The link is valid for 7 days. It accepts one filed answer.
- Three failed identity checks lock the link. Dr. Hofer can send a new request.
- Until the identity check passes, the page shows only the requesting doctor and clinic.

## Widget

Dr. Hofer sends requests and makes every decision about them in the ordy widget. `pnpm matrix:bootstrap` pins it in her room. There are no chat commands for requests.

The widget uses `matrix-widget-api` to get a Matrix OpenID token from Element after the user approves identity sharing, and sends it as `Authorization: Bearer` with every clinic tRPC call. Patient and audit data come only from `clinic.patients` and `clinic.audit`, both protected by `clinicProcedure`; neither page embeds that data in its initial HTML or React server payload. Tokens and the clinic query cache stay in memory and are discarded on expiry or unmount. The widget includes an **Audit log** tab. The request service checks the token with Synapse (`verifyOpenIdToken` in `src/server/matrix/client.ts`). It accepts only users on its own homeserver, `MATRIX_SERVER_NAME`, which is `klinikum.example` in the demo. The checked Matrix ID is the actor in the audit log.

| Part of the widget | Effect |
|---|---|
| Request form | Creates a request and sends the email or SMS |
| **Send anyway** | Sends a request despite the address warning |
| **Accept** | Accepts a held identity or a held answer |
| **Reject** | Rejects a held identity or a held answer |
| **Cancel** | Cancels an open request |
| Request list | Shows each request with its state and its audit entries |

The request form has the document type, the patient, the given name, the family name, the organisation, and either an email address or a phone number. The request procedure rejects a request unless it has a patient, a given name, a family name, an organisation, and either an email address or a phone number. Separate given and family name fields avoid guessing which part of "Eva Maria Brandl" is the family name.

| Field | Request 1 | Request 2 |
|---|---|---|
| Document type | `lab-result` | `rehab-report` |
| Patient | Maria Beispiel | Maria Beispiel |
| Given name, family name | Eva, Brandl | Stefan, Kern |
| Organisation | Labor Kanalstraße | Reha Waldblick |
| Contact | `eva.brandl@labor-kanal.example` | `+43 660 000 0101` |

If the address check fails, the widget shows the warning next to **Send anyway** and **Cancel**: "The address domain `labor-kanaI.example` does not match Labor Kanalstraße (`labor-kanal.example`)."

## Matrix bot

The bot listens in rooms it has joined. It accepts commands from any Matrix user on `MATRIX_SERVER_NAME` and ignores everyone else (`src/bot/main.ts`). It has two commands. `!help` lists them, and `!status` checks the database, the FHIR server, and Matrix.

The request service posts notices in Dr. Hofer's room as the bot user, with `notifyRoom` in `src/server/matrix/notices.ts`. Each notice is a plain-text `m.notice`, never HTML, because the names in it come from Dr. Hofer's input and from ID Austria. The first notice of a request starts a thread, and the request service stores its event id in `requests.matrix_event`. Later notices go into that thread with an `m.thread` relation. Their reply fallback points to the first notice, so a client without threads shows them as replies to it.

| When | Notice |
|---|---|
| The request goes out | "Request 1 sent to Dr. Eva Brandl (Labor Kanalstraße) by email." |
| An identity check fails (M1, M2) | "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address." |
| The patient check fails (M3) | "The answer to request 1 is about a different patient. Name and birth date do not match Maria Beispiel. Nothing was filed." |
| The name matches only partly | "Request 1 is on hold. The ID Austria name Petra Brandl matches Dr. Eva Brandl only in part. Accept or reject the person in the widget." |
| The release check does not pass | "The answer to request 1 is on hold. The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße. Accept or reject the answer in the widget." |
| The answer is filed | "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range." |

The caller writes the reason sentence of a held notice. A filed lab result with values outside the reference range says how many, for example "4 values, 1 outside the reference range." A rehab discharge report has no values, so its filed notice ends after "Identity checked with ID Austria."

## Outgoing messages

The email and the SMS name the requesting doctor and clinic, the link, and the expiry date. Nothing else.

```
Subject: Secure request from Klinikum Beispielstadt

Hello,

Dr. Lena Hofer at Klinikum Beispielstadt has sent you a secure request.
Open it here: http://localhost:3010/r/<link token>

You need ID Austria to open it. The link expires on 5 November 2026.
If you did not expect this message, you can ignore it.
```

```
Klinikum Beispielstadt: Dr. L. Hofer sent you a secure request. Open it with ID Austria: http://localhost:3010/r/<link token> (valid until 5 Nov)
```

Before sending, the request service compares the words of the message with the patient's name words, the birth date in the formats `1961-03-12`, `12.03.1961`, and `12 March 1961`, and the document type words. It compares whole words, not substrings. A substring check would block every message, because the patient's family name "Beispiel" is part of "Klinikum Beispielstadt". [Compliance and safety](COMPLIANCE_AND_SAFETY.md) has the rule.

## Outside portal

| Route | What it does |
|---|---|
| `GET /r/{token}` | Writes `link_opened`. Shows the requesting doctor and clinic and a **Log in with ID Austria** button. |
| `GET /auth/login` | Redirects to Keycloak with `state`, `nonce`, PKCE, and `prompt=login`. |
| `GET /auth/callback` | Swaps the code for tokens, verifies the ID token, runs the identity checks, and writes `identity_checked`. |
| `GET /r/{token}/answer` | Shows the patient, the requested document, the upload field, and fields for the patient's name and birth date. Only after the identity check passes. |
| `POST /r/{token}/answer` | Writes `answer_sent`, parses the document, runs the patient check, files the resources, and writes `answer_filed`. |
| `GET /sms` | Shows every SMS the request service would have sent, like a phone screen. |
| `GET /audit` | Audit UI; data requires a verified Matrix clinic identity. Use the widget's **Audit log** tab in Element. |

The pages are Next.js routes. `/auth/login` and `/auth/callback` are route handlers, because they need real redirects and cookies. The answer page loads its data and sends the upload through tRPC (`eidProcedure`, the upload as `FormData`).

A signed session cookie (`ordy_eid_session`, see `src/server/auth/eid-session.ts`) holds the request id and, after login, the person number (the bPK, never `sub`). It expires after 30 minutes.

## Document parsing

The scenario documents share one Markdown format:

- a heading `# <Organisation>: <document kind>`, for example `# Labor Kanalstraße: lab report`
- `Key: value` lines such as `Patient`, `Sample taken`, `Reported`, `Stay`, `Validated by`, `Written by`, and `Sent by`
- for lab results, a table with the columns `Test`, `Result`, `Unit`, `Reference range`, and `LOINC code`
- free text sections such as `## Course` and `## Recommendations`

The parser reads headings and tables from markdown-it tokens and splits `Key: value` lines at the first `": "`. It reads dates against a fixed list of formats in the `Europe/Vienna` time zone, for example `22 October 2026, 08:10`. The `Patient` line splits at `", born "` into name and birth date.

The document kind picks the mapper. `lab report` goes to the lab mapper and `discharge report` goes to the rehab mapper. Any other kind becomes a DocumentReference with the text attached, held for Dr. Hofer.

The parser lives in `src/server/documents/`. `parseDocument()` returns a typed `LabResult`, `RehabReport`, or generic document (`types.ts`), or a list of reasons the uploader can act on; it never throws on content and never returns a half-read document. It refuses a document without a heading or a readable `Patient` line, a known key on more than one line with different values (a second `Patient` line could slip past the patient check), a lab report without exactly one result table, a result that is not a number (also `1,245`, which could mean 1245 or 1.245), a LOINC code with a wrong format or check digit, and a missing or unreadable date or stay line that the kind needs. Inside a `##` section only known keys such as `Written by` count, so a sentence with a colon stays text. Outside the sections a line with an unknown key such as `Note:` is a field and free text, so it still reaches the conclusion. A byte order mark at the start is ignored. Person lines split off titles such as `Dr.`, `Dr.in`, or `Prim.` with the same rule as `nameWords`. It converts the unit `10^9/L` to UCUM `10*9/L`, computes `N`, `H`, or `L` from the reference range, and reads a stay that names the month once, twice, or crosses a year. `checkAnswerPatient()` in `patient-check.ts` runs `samePatient()` on the document and on the form. A patient record without a family name or birth date never matches. `uploadHash()` gives the SHA-256 that stays in the audit log when an upload is discarded.

### AI fallback (optional, cut first)

If the parser cannot read a document, a language model may extract the same fields as JSON against a fixed schema. Every value and every LOINC code it returns must appear word for word in the document. The patient check stays deterministic. An answer read by the model always waits until Dr. Hofer accepts it in the widget.

## Storage

The request service keeps three Postgres tables, defined with Drizzle in `src/server/db/schema.ts`. Migrations live in `drizzle/`. `audit_log` exists already. `requests` and `bindings` come with T04.

| Table | Columns |
|---|---|
| `requests` | `id`, `doc_type`, `patient_id`, `given`, `family`, `org`, `channel`, `address`, `state`, `link_hash`, `failed_checks`, `created_at`, `expires_at`, `matrix_room`, `matrix_event` |
| `bindings` | `given`, `family`, `org`, `person_number`, `practitioner_id`, `first_verified_at` |
| `audit_log` | `id`, `at`, `event`, `request_id`, `actor_kind`, `actor`, `outcome`, `detail` |

`bindings` remembers which ID Austria person number answered as a given person at a given organisation. The audit log never holds document text.

## Audit log

| Event | Who | What |
|---|---|---|
| `request_sent` | Dr. Hofer's Matrix ID | Document type, channel, recipient address |
| `link_opened` | An anonymous browser session, with a hash of the IP address | Request id |
| `identity_checked` | The ID Austria name and person number | `pass`, `hold`, or `fail`, with the reason for each check |
| `answer_sent` | The verified person | SHA-256 and size of the upload |
| `answer_filed` | The request service | FHIR resource ids and the Provenance id |
| `misdelivery_caught` | Whoever triggered it | `address_mismatch`, `wrong_person`, or `patient_mismatch` |

Every entry has a UTC timestamp in `at`. The widget and `GET /audit` show the entries.

## Configuration

Configuration is read in `src/env.ts`. Service addresses and demo accounts have defaults. Outside-person sessions require a private `ORDY_SECRET`; an empty, short, or known placeholder key cannot sign or authenticate sessions. Setup generates a random key and preserves it across reruns. `.env.example` lists the variables.

| Variable | Default |
|---|---|
| `PUBLIC_URL` | `http://localhost:3010` |
| `ORDY_SECRET` | empty (outside-person sessions disabled); setup writes a private 32-byte random key to `.env` |
| `DATABASE_URL` | `postgres://ordy:ordy@localhost:5433/ordy` |
| `FHIR_BASE_URL` | `http://localhost:8090/fhir` |
| `MATRIX_HOMESERVER_URL`, `MATRIX_SERVER_NAME` | `http://localhost:8008`, `klinikum.example` |
| `MATRIX_BOT_USER`, `MATRIX_BOT_PASSWORD` | `ordy`, demo value |
| `MATRIX_HOFER_USER`, `MATRIX_HOFER_PASSWORD` | `lena.hofer`, demo value (setup scripts only) |
| `MATRIX_ROOM_ALIAS` | `outside-documents` |
| `OIDC_METADATA_URL` | `http://localhost:8080/realms/idaustria-sim/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | `request-service`, `request-service-demo-2026` |
| `KEYCLOAK_ADMIN_USER`, `KEYCLOAK_ADMIN_PASSWORD` | `admin`, demo value (`pnpm citizen` only) |
| `EHVD_URL` | `http://localhost:8095/` (planned, T15) |
| `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_API_URL` | `localhost`, `1025`, `http://localhost:8025` |
| `ANTHROPIC_API_KEY` | unset, only for the optional AI fallback |

To switch to real ID Austria, change `OIDC_METADATA_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`. The simulator already sends the real claim names, which [Identity and misdelivery](IDENTITY.md) lists.

## Repository layout

Files marked *planned* do not exist yet. The task id says who builds them.

```
docker-compose.yml            Synapse, Element, HAPI, Mailpit, Postgres, Keycloak (eHVD mock: T23)
.env.example                  all variables with demo values
docker/element/config.json    Element config
docker/synapse/               generated homeserver.yaml (git ignores it)
docker/keycloak/idaustria-sim-realm.json   simulated ID Austria: client, mappers, test citizens
docs/ehvd/eHVD.wsdl           the real eHVD WSDL, version 2 from BRZ
services/ehvd-mock/           eHVD mock service and its synthetic directory, planned, T23
drizzle/                      generated SQL migrations
src/
  env.ts                      zod-validated configuration
  app/                        Next.js pages and route handlers
    api/trpc/[trpc]/route.ts  tRPC endpoint
    api/healthz/route.ts      health check for scripts and containers
    widget/                   request form inside Element. Sending is planned, T04 and T05
    r/[token]/                outside portal: landing page and answer form. Data loading planned, T04, T07, T09
    auth/                     ID Austria login, planned, T07
    sms/page.tsx              SMS screen. Reading the SMS log planned, T06
    audit/page.tsx            audit UI; authenticated data via clinic.audit
  components/ui/              shadcn/ui components, added with `pnpm dlx shadcn@4.22.1 add <name>`
  components/                 shared UI such as the portal frame
  lib/                        code shared by server and browser: document types, request input, `cn`
  trpc/                       React client for tRPC (TanStack Query)
  server/
    api/trpc.ts               context and procedures: public, clinic, eid
    api/root.ts               app router and createCaller
    api/routers/              one router per area
    db/                       Drizzle schema and client
    fhir/                     FHIR client, lab and rehab mappers (T12, T14)
    documents/                parser and patient check (T10, T11), typed records in types.ts, the scenario documents as parsed records for tests
    identity/names.ts         name words and subset test from Identity, shared by the patient check and T08
    ehvd/oid.ts               OID check shared by the login and pnpm citizen
    ehvd/                     eHVD SOAP client, planned (T15)
    matrix/client.ts          Matrix client-server API
    matrix/notices.ts         notice texts and notifyRoom for Dr. Hofer's room
    auth/eid-session.ts       outside person's session cookie
    portal/data.ts            data loaders for the portal and SMS pages, stubs until T04, T06, T07
  bot/                        Matrix bot process and commands
scripts/
  setup.sh                    one-time setup
  reset.sh                    empty Postgres, HAPI, and Mailpit, reload the patient
  bootstrap-matrix.ts         room, invites, widget
  seed-fhir.ts                Maria Beispiel into HAPI
  citizen.ts                  add a test citizen to the simulated ID Austria
  validate.ts                 planned, T18: HL7 validator on every filed resource
  audit-check.ts              planned, T17: six event types per request
track/                        track brief, scenario, patient.json, and test documents
```

## Run it

[Development](DEVELOPMENT.md) has the full guide. In short:

1. `./scripts/setup.sh` once. It creates `.env`, starts the containers, registers the Matrix users, migrates the database, loads the patient, and creates Dr. Hofer's room with the widget.
2. `pnpm dev` starts Next.js on `http://localhost:3010` and the bot.
3. Open Element at `http://localhost:8081` and log in as `lena.hofer` / `hofer-demo-2026`. The room "Dr. Hofer · Outside documents" is there. Send `!status`.
4. Mailpit is at `http://localhost:8025`, the SMS screen at `http://localhost:3010/sms` (T06).

## Sources

- [Synapse](https://github.com/element-hq/synapse) and [Element Web](https://github.com/element-hq/element-web)
- [Keycloak: importing and exporting realms](https://www.keycloak.org/server/importExport) and [server administration guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
- [openid-client](https://github.com/panva/openid-client)
- [Next.js documentation](https://nextjs.org/docs), [tRPC](https://trpc.io/docs), [Drizzle ORM](https://orm.drizzle.team/docs/overview)
- [Mailpit](https://mailpit.axllent.org/)
- [HAPI FHIR JPA server starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
