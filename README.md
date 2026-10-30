# ordy: Track 2, health data interoperability

This is our entry for [Track 2 of the AIM hackathon](https://github.com/AIM-Austria/TRACK-2-interoperability). Dr. Lena Hofer works inside PGK, a closed document network built on Matrix. ordy lets her request a document from someone outside the network, such as a lab or a rehab clinic. The outside person gets a link by email or SMS, logs in with ID Austria, and answers in the browser, with no account and nothing to install. ordy checks that the right person answered about the right patient, files the answer as FHIR R4 with a Provenance resource on the clinic's FHIR server, and tells Dr. Hofer in her Matrix room.

Prototype on synthetic data only. Not a medical device. Not for clinical use. Read the [disclaimer](#disclaimer).

[Status](#status) · [Run it](#run-it) · [Architecture](#architecture) · [Design answers](#design-answers) · [Metrics](#metrics) · [Documents](#documents) · [Disclaimer](#disclaimer)

## Status

Status on `main`, 30 October 2026: the scenario does not run end to end yet. Dr. Hofer cannot send a request yet, so no answer can be filed, and no metric is measured.

| Part | State |
|---|---|
| Stack: Synapse, Element, HAPI FHIR, Mailpit, Postgres, Keycloak, eHVD mock, ordy web and bot | Works. `./scripts/setup.sh` and `pnpm dev` start it. |
| Dr. Hofer's room with the pinned ordy widget | Works: Matrix sign-in, patient list from HAPI, audit log tab. The request form checks its input but does not send yet. |
| Matrix bot | Works: `!help` and `!status` |
| Simulated ID Austria (Keycloak) | Works: the real ID Austria claim names, five test citizens, `pnpm citizen` for more. ordy's login page does not use it yet. |
| eHVD mock | Works: SOAP 1.2 with the real eHVD WSDL and synthetic entries. ordy does not call it yet. |
| Document parser and patient check | Built and tested on the scenario documents and our [extra test documents](track/scenario/extra/index.md), which also list the parser's known gaps. Not connected to an upload yet. |
| Identity checks at login (level, name, person number, eHVD claim) and the Matrix notices | Built and tested. Not called yet, because the login is missing. |
| Sending the request by email or SMS, the ID Austria login in ordy, the answer upload | Not built yet |
| FHIR mapping and filing (Observations, DiagnosticReport, DocumentReference, Provenance, Task) | Not built yet |
| eHVD address check and release check in ordy | Not built yet |
| Metric scripts (`pnpm validate`, `pnpm audit:check`) | Not built yet |
| AI fallback parser | Optional, not built |

[Timeline](docs/TIMELINE.md) has the tasks and owners.

## Run it

Requirements: Docker with Compose v2, Node.js 22 or newer, pnpm 10 (`corepack enable`), and Java 17 or newer for the HL7 validator. These ports must be free: 3010, 5433, 8008, 8081, 8090, 8025, 1025, 8080, and 8095. [Development](docs/DEVELOPMENT.md) has the full guide and troubleshooting.

```bash
git clone https://github.com/Chaissen/AIM-Hackathon.git
cd AIM-Hackathon
./scripts/setup.sh   # once: .env, containers, Matrix users, database, FHIR patient, Matrix room and widget
pnpm dev             # Next.js on http://localhost:3010 and the Matrix bot
```

`setup.sh` is safe to run again. The first run downloads the container images, and HAPI FHIR needs about a minute to start.

| What | URL | Login |
|---|---|---|
| ordy status page | http://localhost:3010 | |
| Element (Dr. Hofer) | http://localhost:8081 | `lena.hofer` / `hofer-demo-2026` |
| Mailpit (outside emails) | http://localhost:8025 | |
| SMS screen | http://localhost:3010/sms | |
| HAPI FHIR | http://localhost:8090/fhir | |
| Simulated ID Austria (Keycloak) | http://localhost:8080 | Test citizens such as `eva.brandl` / `demo-eva`, see [Identity](docs/IDENTITY.md#test-citizens) |
| Postgres | `postgres://ordy:ordy@localhost:5433/ordy` | `ordy` / `ordy` |
| eHVD mock (WSDL) | http://localhost:8095/ehvd.wsdl | |

Check that it works:

1. http://localhost:3010 shows three green dots for the database, the FHIR server, and Matrix.
2. In Element, open the room "Dr. Hofer · Outside documents". `!help` lists the bot commands. `!status` checks the database, the FHIR server, and Matrix.
3. Open the ordy widget in the room and approve Element's identity request. The request form lists Maria Beispiel.
4. http://localhost:8095/healthz shows `{"status":"ok","entries":313}`, the eHVD mock.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js (`dev:web`) and the Matrix bot (`dev:bot`), both reload on changes |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` | Checks before every push |
| `pnpm reset` | Empty Postgres, HAPI, and Mailpit, and reload the patient |
| `pnpm citizen --given <given> --family <family> --birthdate <yyyy-mm-dd>` | Add a test citizen to the simulated ID Austria, for example a new outside person |
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

The diagram shows the design. [Status](#status) says which parts work today.

Dr. Hofer fills in the request form in the ordy widget inside her Matrix room. The widget calls ordy with a Matrix OpenID token, which ordy checks with Synapse. ordy sends the outside person a link by email or SMS that names no patient and no document type. The outside person logs in with the simulated ID Austria over OpenID Connect. ordy runs the identity checks before it shows the patient, parses the uploaded Markdown document, checks that it is about the right patient, and files it on HAPI FHIR as one transaction Bundle. The bot is a second Node.js process. It calls the same tRPC router in-process and posts notices in Dr. Hofer's room. Every step writes an audit entry to Postgres.

| Component | Built or reused | Role |
|---|---|---|
| ordy web | Built: Next.js 16, tRPC v11, zod, Drizzle, shadcn/ui | Widget for Dr. Hofer, outside portal, identity checks, parser, patient check, FHIR mapping, audit log, SMS screen |
| ordy bot | Built: Node.js process with a small Matrix client on `fetch` | `!help`, `!status`, and the notices in Dr. Hofer's room |
| eHVD mock | Built: Node.js service in `services/ehvd-mock/` | The Austrian eHealth directory with the real SOAP interface and synthetic entries |
| Synapse and Element Web | Reused | Matrix server for `klinikum.example` and Dr. Hofer's chat client |
| Keycloak | Configured | Simulated ID Austria with the real claim names |
| HAPI FHIR | Reused | FHIR R4 server |
| Postgres | Reused | Requests, person number bindings, audit log |
| Mailpit | Reused | Catches every outgoing email |
| HL7 validator | Reused | Validates every filed resource |

The main flow uses no AI model. Parsing, the identity checks, and the patient check are deterministic. An optional AI fallback parser may only read documents, never decide, and its answers always wait for Dr. Hofer ([AI rules](docs/COMPLIANCE_AND_SAFETY.md#ai-rules)).

Simulated in the demo: ID Austria (Keycloak, without the phone-app confirmation), the eHVD (our mock), email (Mailpit), and SMS (the SMS screen). Every reused part can be replaced, for example Keycloak by real ID Austria. [Whitepaper](docs/WHITEPAPER.md#what-is-real-and-what-is-simulated) says what each part becomes in production, and [Architecture](docs/ARCHITECTURE.md) has the details.

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

Dependencies must be public for at least 7 days (`minimumReleaseAge` in `pnpm-workspace.yaml`).

## Design answers

Short answers to the five questions of the track. The [Whitepaper](docs/WHITEPAPER.md#design-answers) has the full answers and the reasons.

### 1. How does an outside person prove who they are if they are in no directory?

They log in with ID Austria, the Austrian state electronic ID. It gives ordy their verified name, birth date, and a person number (bPK) that stays the same for our service. ordy compares the name with the name Dr. Hofer typed. Two facts back this up: the link went only to the email address or phone number Dr. Hofer gave, and the Austrian eHealth directory (eHVD) lists healthcare professionals with their role and organisation. After the first verified answer, ordy stores the person number, so only that exact person can answer as "Eva Brandl" again. The person needs no account with us and no directory entry.

### 2. Which identity check do you require for each type of document and why?

Every outside person sees the patient once the identity check passes, so every document type needs an ID Austria login with full function and a name match. Under Austrian law, only the physician responsible for the content may release a document, so ordy also checks that person in the eHVD.

| Document | Sender check | Release check | Why |
|---|---|---|---|
| Lab result | ID Austria full function, name match, person number if known | The physician under `Validated by` is an active lab medicine specialist at the lab | A lab report is a specialist's document, and its values feed a clinical decision |
| Rehab discharge report | ID Austria full function, name match, link sent to the phone number Dr. Hofer gave | The physician under `Written by` is an active physician at the rehab clinic, and the clinic is an active hospital | The signing physician is responsible for the report. The discharge manager only sends it. |
| Release not confirmed by the eHVD | As above | The answer waits until Dr. Hofer accepts it | The eHVD can be out of date, so a physician decides |

### 3. Which FHIR resources do you create and how do they reference each other and the patient?

| Answer | Resources |
|---|---|
| Lab result | One Observation per test with its LOINC code, UCUM unit, and reference range, grouped by one DiagnosticReport that carries the original document |
| Rehab report | One DocumentReference with the report text attached and the stay period |
| Every answer | One Provenance that targets everything filed and records who sent it, when, and how the identity was checked, including the signed ID Austria token |
| Every request | One Task from sent to completed, pointing at the filed results |
| People and organisations | Practitioner and Organization for Dr. Hofer, the sender, the document author, and their organisations |

Every clinical resource points at the Patient through `subject`. One answer is filed as one transaction Bundle, so it is filed completely or not at all. [FHIR model](docs/FHIR.md) has the reference diagram and the field mapping.

### 4. How do you notice a misdelivery?

ordy checks at three points. Each catch writes a `misdelivery_caught` audit entry and tells Dr. Hofer in Matrix.

1. Before sending: an email domain that differs from the organisation's domain in the eHVD, such as `labor-kanaI.example`, needs Dr. Hofer's confirmation.
2. At login: the ID Austria name must match the requested person. A stranger at a mistyped address (M1) and a colleague with a forwarded email (M2) fail here and see nothing about the patient.
3. On answer: the patient's name and birth date in the document and in the form must match the patient record. A result for another patient (M3) is not filed.

### 5. Where does your service run: at the clinic, at the outside organisation or at a third party?

At the clinic, next to the Matrix server and the FHIR server it already runs. Patient data leaves the clinic only toward the person who proved their identity. The outside organisation runs nothing; its staff need a browser and ID Austria. A third party such as the PGK operator could later run one shared instance, but it would then hold patient data from every clinic.

## Metrics

We measure the four track metrics on the scenario, on the frozen build. The results are pending until the flow runs end to end. [Whitepaper](docs/WHITEPAPER.md#how-we-measure-the-metrics) has the method in full.

| Metric | Target | How we measure | Result |
|---|---|---|---|
| FHIR validation | 0 errors | Run the HL7 validator (`-version 4.0`) on every resource filed during a scenario run and count issues with severity `error`. `pnpm validate` will do this. | Pending |
| Effort for the outside person | 0 installs, 0 accounts, under 2 minutes | Someone new answers request 1 with a stopwatch running from opening the email in Mailpit to pressing send. The audit times back up the stopwatch. ID Austria counts as an existing state ID, not as an account with us. | Pending |
| Misdeliveries caught | 3 of 3 | Run M1, M2, and M3 from [`misdelivery.md`](track/scenario/misdelivery.md) on request 1. Each must show the outcome the test names and a `misdelivery_caught` audit entry. | Pending |
| Audit coverage | 6 of 6 | Check that a request has all six event types, each with who, what, and when: `request_sent`, `link_opened`, `identity_checked`, `answer_sent`, `answer_filed`, `misdelivery_caught`. `pnpm audit:check` will do this. | Pending |

## Documents

| Document | What it covers |
|---|---|
| [Whitepaper](docs/WHITEPAPER.md) | The problem, the solution, our answers to the five design questions, and how we measure the metrics |
| [Development](docs/DEVELOPMENT.md) | Set up, start, reset, and extend the stack; troubleshooting |
| [Architecture](docs/ARCHITECTURE.md) | Components, ports, the request lifecycle, the Matrix bot, messages, parsing, and the audit log |
| [eHVD](docs/EHVD.md) | The real eHVD SOAP interface, what is public about it, our mock, and how ordy uses it |
| [Identity and misdelivery](docs/IDENTITY.md) | Real ID Austria and eHVD, the Keycloak simulation, the identity checks, and the three misdelivery tests |
| [FHIR model](docs/FHIR.md) | The resources we file, how they reference each other, and how we validate them |
| [Demo script](docs/DEMO.md) | Draft click path for the 2-minute video |
| [Timeline](docs/TIMELINE.md) | Milestones, tasks, owners, and the cut list |
| [Compliance and safety](docs/COMPLIANCE_AND_SAFETY.md) | Synthetic data, message rules, data we keep, AI rules, and the disclaimer |
| [UML diagrams](docs/UML.md) | Use cases, domain classes, and component relations |
| [Track brief](track/README.md) and [scenario](track/scenario/README.md) | The task as the organisers wrote it |

## Disclaimer

> **Important notice.** This software is a prototype built for the AIM hackathon 2026. It is not a medical device, it has not been clinically validated, and no regulatory body has approved or certified it. It uses fictional, synthetic data only. ID Austria and the eHVD are simulated.
>
> Do not use it to diagnose, treat, or monitor any condition, or to make any clinical decision. Do not enter real patient data or any personal data. The authors accept no liability for any use outside the hackathon demonstration.

Every page of the app shows the short form in its footer: "Prototype with synthetic data. ID Austria is simulated. Not for clinical use."
