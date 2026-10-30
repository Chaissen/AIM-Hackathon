# ordy: Track 2, health data interoperability

This is our entry for [Track 2 of the AIM hackathon](https://github.com/AIM-Austria/TRACK-2-interoperability). Dr. Lena Hofer works inside PGK, a closed document network built on Matrix. ordy is designed to let her request a document from someone outside the network, such as a lab or a rehab clinic. The outside person gets a link by email or SMS, logs in with ID Austria, and answers in the browser, with no account and nothing to install. ordy checks that the right person answered about the right patient, files the answer as FHIR R4 with a Provenance resource on the clinic's FHIR server, and tells Dr. Hofer in her Matrix room. All of this runs today except sending the SMS. [Status](#status) says what runs.

[Status](#status) · [Run it](#run-it) · [Architecture](#architecture) · [Design answers](#design-answers) · [Metrics](#metrics) · [Documents](#documents) · [Disclaimer](#disclaimer)

## Status

Historical metric evidence on `main` at commit `06abdc9`, 30 October 2026, 03:20 CET. Request 1 with M1 to M3, and the rehab request, run end to end by hand, with one gap in the flow: ordy did not send the email or the SMS yet, so the links came from the `pnpm dev` log. The metric results in [Metrics](#metrics) come from that run. Since then, #4 sends the request email, and the SMS screen shows each SMS with its link.

The feature table describes this checkout. The workspace gateway and hostname migration are documented below; the public deployment is a separate action.

| Part | State |
|---|---|
| Stack: Synapse, workspace gateway, HAPI FHIR, Mailpit, Postgres, Keycloak, eHVD mock, ordy web and bot | **Works.** `./scripts/setup.sh` and `pnpm dev` start it. |
| ordy workspace | **Works.** The app root provides ordy's own sign-in, shared document workflows, and Messages in one design. Existing Matrix accounts sign in without Element. Messages shows joined plaintext rooms, text and bot notices, older history, and a composer. The document views remain Overview, Requests, a request's page, New request, Patients, a patient's page, Contacts, Audit log, and Metrics. Each view has a hash route. |
| Element Web and the ordy widget | **Works.** Element Web is the chat app the track suggests. It starts with the other containers on port 8082, and the ordy widget at `/widget` is pinned in Dr. Hofer's room. |
| Address check before sending, against the eHVD | **Works.** An email domain that does not match the organisation's domain in the eHVD holds the request until Dr. Hofer clicks **Send anyway** (M1). |
| Outside portal: landing page, ID Austria login, identity checks, answer page, upload | **Works.** The landing page shows only the requesting doctor and clinic. A wrong person (M1, M2) is refused at login and sees neither the patient nor the document type. The right person uploads the document and confirms the patient's name and birth date. |
| Answer: parser, patient check, eHVD release check, FHIR filing | **Works.** A document about another patient (M3) is not filed. The release check confirms the responsible physician in the eHVD; if it cannot, the answer waits for Dr. Hofer's **Accept**. The lab result is filed as four Observations and a DiagnosticReport, the rehab report as a DocumentReference, each in one transaction Bundle with Provenance, Task, Practitioner, and Organization. |
| Matrix notices | **Works** for a wrong person, a wrong patient, a held identity or answer, and a filed answer. Nothing posts a "request sent" notice yet, so each notice is a new message in the room, not in a thread. |
| Matrix bot | **Works.** `!help` and `!status` |
| Simulated ID Austria (Keycloak) and eHVD mock | **Works.** The real ID Austria claim names, five test citizens, `pnpm citizen` for more. The eHVD mock speaks SOAP 1.2 with the real eHVD WSDL and synthetic entries. |
| Request email | **Works.** The request form and **Send anyway** send the link by email to Mailpit. A check refuses an email that names the patient, the birth date, or a document type. A refused or failed email stores nothing. |
| SMS, and the SMS screen's message list | **Works.** An SMS request puts its SMS on the SMS screen at `/sms`, after the same content check as the email. No SMS is really sent. |
| AI fallback parser (optional) | **Built, not connected.** Tested with a stand-in for the model. The answer flow uses the rule-based parser only. |
| Metric runner | **Partly.** `pnpm validate` and `pnpm audit:check` work on the filed data. `pnpm scenario` checks that the stack is up, but its flow steps have no code yet that drives them, so it reports them as blocked. |

[Timeline](docs/TIMELINE.md) has the tasks and owners.

## Run it

Requirements: Docker with Compose v2, Node.js 22.9 or newer, and pnpm 10 (`corepack enable`, or `npm install -g pnpm@10` on Node.js 25 and newer, which no longer ship Corepack). The HL7 validator also needs Java 17 or newer and internet access, because it checks LOINC codes against tx.fhir.org. These ports must be free: 3010, 5433, 8008, 8081, 8082, 8090, 8025, 1025, 8080, and 8095. [Development](docs/DEVELOPMENT.md) has the full guide and troubleshooting. [Deployment](docs/DEPLOYMENT.md) covers the public chat hostname and existing Element installations.

```bash
git clone https://github.com/Chaissen/AIM-Hackathon.git
cd AIM-Hackathon
./scripts/setup.sh   # once: .env, containers, Matrix users, database, FHIR patient, Matrix room and widget
pnpm dev             # Next.js on 3010 and the bot; open the workspace through 8081
```

`setup.sh` is safe to run again. The first run downloads the container images, and HAPI FHIR needs about a minute to start.

| What | URL | Login |
|---|---|---|
| ordy workspace | http://localhost:8081 | `lena.hofer` / `hofer-demo-2026` |
| ordy app and outside portal | http://localhost:3010 | the same workspace is available here |
| Element Web | http://localhost:8082 | the same Matrix account |
| Mailpit (outside emails) | http://localhost:8025 | |
| SMS screen | http://localhost:3010/sms | none. Demo only. A production build answers 404. |
| HAPI FHIR | http://localhost:8090 (web UI), API base http://localhost:8090/fhir | |
| Simulated ID Austria (Keycloak) | http://localhost:8080/admin | `admin` / `keycloak-demo-2026` for the admin console. Test citizens such as `eva.brandl` / `demo-eva` log in through the link of a request, see [Identity](docs/IDENTITY.md#test-citizens). |
| Postgres | `postgres://ordy:ordy@localhost:5433/ordy` | `ordy` / `ordy` |
| eHVD mock (WSDL) | http://localhost:8095/ehvd.wsdl | |

For an existing installation whose port 8081 serves Element, follow [the workspace migration](docs/DEPLOYMENT.md#migrate-an-existing-element-entry). Deployment of the public hostname is a separate step from merging this code.

Check that it works:

1. http://localhost:3010/api/healthz returns the database, FHIR, and Matrix health checks.
2. Open http://localhost:8081 and sign in as `lena.hofer` / `hofer-demo-2026`. This is ordy's own workspace, with the same design as the document views.
3. Open **Messages** and choose "Dr. Hofer · Outside documents". `!help` lists the bot commands; `!status` checks the database, the FHIR server, and Matrix.
4. http://localhost:8095/healthz shows `{"status":"ok","entries":313}`, the eHVD mock.
5. Open **New request**, choose **Examples**, then **Lab result from Dr. Brandl**, and click **Send request**. The email arrives in Mailpit at http://localhost:8025, or in the recipient's inbox at http://localhost:3010/inbox. Open its link in a private window, log in as `eva.brandl` / `demo-eva`, upload `track/scenario/documents/lab-result-maria-beispiel.md`, and enter Maria Beispiel and 12 March 1961. The answer is filed on HAPI FHIR, and a notice appears in **Messages**. Log in as `thomas.wagner` / `demo-thomas` instead, and the page says "This request is for someone else". The request's history shows the blocked login.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js (`dev:web`) and the Matrix bot (`dev:bot`), both reload on changes |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` | Checks before every push |
| `pnpm reset` | Empty Postgres, HAPI, and Mailpit, and reload the three synthetic patients |
| `pnpm citizen --given <given> --family <family> --birthdate <yyyy-mm-dd>` | Add a test citizen to the simulated ID Austria, for example a new outside person |
| `pnpm db:generate --name <name>` · `pnpm db:migrate` | Create a migration from `src/server/db/schema.ts`, apply it |
| `pnpm db:studio` | Browse the database |
| `pnpm fhir:seed` · `pnpm matrix:bootstrap` | Load the three synthetic patients; create the room and pin the widget |
| `pnpm demo:seed` | Fill Dr. Hofer's workspace with eleven synthetic requests in every state, through the real code paths ([Demo](docs/DEMO.md#a-populated-workspace)) |
| `pnpm scenario` · `pnpm validate` · `pnpm audit:check` | All four metrics in one run, once its flow steps have code that drives them (today they report blocked); the HL7 validator on the filed resources; the six audit events per request |

## Architecture

```
Dr. Hofer -> workspace gateway -> ordy workspace (Next.js)
                                    +-> tRPC -> Synapse <- ordy bot
                                    +-> tRPC -> Postgres, eHVD, HAPI, SMTP

Outside sender -> request link -> outside portal (Next.js)
                                    +-> ID Austria -> /auth/callback
                                    +-> tRPC -> the same request service
```

This section describes the design. [Status](#status) says which parts work today.

Dr. Hofer signs in to the ordy workspace with her existing Matrix account. An encrypted HttpOnly cookie keeps that workspace session; the server checks it with Synapse. The shared clinical views call the same guarded tRPC procedures, and Messages uses her own Matrix identity. The ordy widget in Element Web keeps its Matrix OpenID-token flow. Before sending, ordy checks the email domain against the organisation in the eHVD. It sends the outside person a link by email or SMS that contains no patient name, no birth date, and no document type. The outside person logs in with the simulated ID Austria over OpenID Connect. ordy runs the identity checks before it shows the patient, parses the uploaded Markdown document, checks that it is about the right patient, checks in the eHVD that the physician responsible for the content may release it, and files it on HAPI FHIR as one transaction Bundle. ordy posts notices in Dr. Hofer's room as the bot user. The bot itself is a second Node.js process that answers `!help` and `!status` and calls the same tRPC router in-process. Every step writes an audit entry to Postgres.

| Component | Built or reused | Role |
|---|---|---|
| ordy web | Built: Next.js 16, tRPC v11, zod, Drizzle, shadcn/ui | Workspace and Messages for Dr. Hofer, optional widget, outside portal, identity checks, parser, patient check, FHIR mapping, audit log, SMS screen |
| ordy bot | Built: Node.js process with a small Matrix client on `fetch` | `!help` and `!status` in Dr. Hofer's room |
| eHVD mock | Built: Node.js service in `services/ehvd-mock/` | Our mock of the eHVD with the real SOAP interface and synthetic entries |
| Synapse | Reused | Matrix server for `klinikum.example` |
| Workspace gateway | Reused: nginx | Same-origin entry for the Next.js workspace on 8081 |
| Element Web | Reused, optional | Legacy Matrix client on 8082 |
| Keycloak | Configured | Simulated ID Austria with the real claim names |
| HAPI FHIR | Reused | FHIR R4 server |
| Postgres | Reused | Requests, person number bindings, audit log |
| Mailpit | Reused | Catches every outgoing email |
| HL7 validator | Reused | Validates every filed resource |
| Anthropic API, model `claude-opus-5-5` | Reused, optional | Second reader for the AI fallback parser, synthetic documents only |

The main flow uses no AI model. Parsing, the identity checks, and the patient check are deterministic. Only when the parser cannot read a document does the optional AI fallback step in: a more lenient code reader reads every value, a model (Anthropic, `claude-opus-5-5`, off without `ANTHROPIC_API_KEY`) reads the document independently, and the two readings must agree. The model can only stop a record, never choose a value. Every answer it read waits for Dr. Hofer ([AI rules](docs/COMPLIANCE_AND_SAFETY.md#ai-rules)). The fallback is built and tested, but the answer flow does not call it yet.

Simulated in the demo: ID Austria (Keycloak, without the phone-app confirmation) and the eHVD (our mock). Email goes to Mailpit, and SMS to the SMS screen at `/sms`. Each can be replaced by the real service, and every other part we did not build, such as HAPI FHIR or Synapse, by another product of its kind. [Whitepaper](docs/WHITEPAPER.md#what-is-real-and-what-is-simulated) says what each part becomes in production, and [Architecture](docs/ARCHITECTURE.md) has the details.

| Part | Where | Notes |
|---|---|---|
| Env | `src/env.ts` | zod-validated, demo defaults for everything |
| tRPC | `src/server/api/` | `publicProcedure`, `clinicProcedure` (Matrix OpenID token or bot), `eidProcedure` (eID session cookie) |
| Database | `src/server/db/` | Drizzle schema, migrations in `drizzle/` |
| FHIR | `src/server/fhir/` | the mappers (`mappers.ts`) and the filing Bundle with Provenance and Task (`filing.ts`, `file-answer.ts`), typed with `@types/fhir` (R4) |
| Documents | `src/server/documents/` | Markdown parser (markdown-it) and patient check |
| Answers | `src/server/answers/` | the answer flow: parse, patient check, release check, then file or hold for Dr. Hofer |
| Identity | `src/server/identity/` | name words for the name match and the patient check |
| eHVD | `src/server/ehvd/` | SOAP client (fetch, saxes), address check, and release check |
| Mail | `src/server/mail/` | request email text, its content check, and the SMTP sender. The request router sends the link with it. |
| Matrix | `src/server/matrix/client.ts` | small client-server API client, no E2EE (not required by the track) |
| Bot | `src/bot/` | separate process for `!help` and `!status`. Requests go through the widget. |
| Client | `src/trpc/` | `@trpc/tanstack-react-query`, superjson |
| AI fallback | `src/server/documents/fallback.ts` | optional, off without `ANTHROPIC_API_KEY`. Provider Anthropic, model `claude-opus-5-5` (`AI_FALLBACK_MODEL`), no server-side fallback model, `@anthropic-ai/sdk` 1.1. Synthetic documents only; every answer it reads is held for Dr. Hofer. |
| Requests | `src/server/requests/`, `src/server/api/routers/request.ts` | request core: lifecycle, link tokens, `request.create`, and the ports the identity checks use |
| Login | `src/app/auth/`, `src/server/auth/` | ID Austria login over OpenID Connect and the outside person's session cookie |
| Audit | `src/server/audit/record.ts` | writes the audit entries |
| Metrics | `src/server/metrics/`, `scripts/` | the runner behind `pnpm scenario`, `pnpm validate`, and `pnpm audit:check` |

Dependencies must be public for at least 7 days (`minimumReleaseAge` in `pnpm-workspace.yaml`).

## Design answers

Short answers to the five questions of the track. They describe our design, and `main` runs it, except that the AI fallback is not connected. [Status](#status) says what runs, and the [Whitepaper](docs/WHITEPAPER.md#design-answers) has the full answers and the reasons.

### 1. How does an outside person prove who they are if they are in no directory?

They log in with ID Austria, the Austrian state electronic ID. It gives ordy their verified name, birth date, and a person number (bPK) that stays the same for our service. ordy compares the name with the name Dr. Hofer typed. Two things back this up. The link went only to the email address or phone number Dr. Hofer gave, so whoever opens it most likely reached it through that inbox or phone, and a forwarded link still fails the name match. And for a healthcare professional such as Dr. Brandl, ordy checks the eHVD, the Austrian eHealth directory, which lists her role and organisation. Later, after her first filed answer, ordy stores the person number, so only that exact person can answer as Eva Brandl at Labor Kanalstraße again. Stefan Kern, a discharge manager, is in no directory at all. For him, ID Austria, the name match, the person number, and the phone number are the whole check, and the eHVD check falls on the physician who wrote the report (question 2). Nobody needs an account with us or an entry in the PGK directory.

### 2. Which identity check do you require for each type of document and why?

Every outside person sees the patient once the identity check passes. So every sender, for every document type, needs an ID Austria login with full function (the identity was checked in person once), a name that matches the person Dr. Hofer named, and the stored person number once one is known. In our reading of Austrian law, only the physician responsible for the content may release a document, so ordy also checks that physician in the eHVD:

| Document | Release check | Why |
|---|---|---|
| Lab result | The physician under `Validated by` is an active lab medicine specialist at the lab | A lab report is a specialist's document, and its values feed a clinical decision |
| Rehab discharge report | The physician under `Written by` is an active physician at the rehab clinic, and the clinic is an active hospital | The signing physician is responsible for the report. The discharge manager only sends it. |

If the eHVD cannot confirm the physician, the answer waits until Dr. Hofer accepts it, because the eHVD can be out of date.

### 3. Which FHIR resources do you create and how do they reference each other and the patient?

| Answer | Resources |
|---|---|
| Lab result | One Observation per test with its LOINC code, UCUM unit, and reference range, grouped by one DiagnosticReport that carries the original document |
| Rehab report | One DocumentReference with the report text attached and the stay period |
| Every answer | One Provenance that targets the clinical resources filed and records who sent it, when, and how the identity was checked, including the signed ID Austria token |
| Every request | One Task from sent to completed, pointing at the DiagnosticReport or DocumentReference |
| People and organisations | Practitioner for Dr. Hofer, the sender, and the document author. Organization for the outside organisation and for ID Austria, which signs the identity proof. |

Every clinical resource points at the Patient through `subject`, and the Task points at her through `for`. The DiagnosticReport lists its Observations in `result`, the Task points at the DiagnosticReport or DocumentReference in `output`, and the Provenance lists the clinical resources in `target` and names the sender and the author in `agent`. One answer is filed as one transaction Bundle, so it is filed completely or not at all. [FHIR model](docs/FHIR.md) has the reference diagram and the field mapping.

### 4. How do you notice a misdelivery?

ordy checks at three points. Each catch writes a `misdelivery_caught` audit entry. Dr. Hofer sees the first in the workspace and gets a Matrix notice for the other two.

1. Before sending: an email domain that differs from the organisation's domain in the eHVD, such as `labor-kanaI.example`, needs Dr. Hofer's confirmation.
2. At login: the ID Austria name must match the requested person. A stranger at a mistyped address (M1) and a colleague with a forwarded email (M2) fail here: they see neither the patient nor the document type, and they cannot answer.
3. On answer: the patient's name and birth date in the document and in the form must match the patient record. A result for another patient (M3) is not filed.

### 5. Where does your service run: at the clinic, at the outside organisation or at a third party?

At the clinic, next to the Matrix server and the FHIR server it already runs. Patient data leaves the clinic only toward the person who proved their identity. The outside organisation runs nothing; its staff need a browser and ID Austria. A third party such as the PGK operator could later run one shared instance, but it would then hold patient data from every clinic.

## Metrics

We measure the four track metrics on the scenario. `pnpm scenario` is meant to run it against the running stack, but its steps have no code yet that drives the flow, so it reports them as blocked. The results below come from one run by hand on `main` at commit `06abdc9`, on 30 October 2026: `pnpm reset`, the requests created as Dr. Hofer by a script that makes the same `request.create` call as the widget's form, the links from the `pnpm dev` log, the logins and uploads in a browser, then `pnpm validate` and `pnpm audit:check`. [Whitepaper](docs/WHITEPAPER.md#how-we-measure-the-metrics) has the method in full.

| Metric | Target | How we measure | Result |
|---|---|---|---|
| FHIR validation | 0 errors | Run the HL7 validator (`-version 4.0`) on every resource filed during a scenario run and count issues with severity `error` or `fatal`. `pnpm validate` runs the same check on its own. | **0 errors** in the 18 resources of the two filing Bundles, for the lab result and the rehab report (HL7 validator 7.0.3). 16 warnings, all `dom-6`: a resource should have a narrative, a best-practice recommendation. |
| Effort for the outside person | 0 installs, 0 accounts, under 2 minutes | Someone new answers request 1 with a stopwatch running from opening the email to pressing send. The audit timestamps from `link_opened` to `answer_sent` confirm the time. ID Austria counts as an existing state ID, not as an account with us. | Not measured yet: the stopwatch test with someone new ([protocol](docs/clinical-review/TIMED_TEST_20.md)) is not done. The team's run by hand needed no install and no account with us. |
| Misdeliveries caught | 3 of 3 | Run M1, M2, and M3 from [`misdelivery.md`](track/scenario/misdelivery.md) with request 1. M2 and M3 run on request 1 itself. M1 sends request 1 to the mistyped address, which makes it a request of its own. Each must show the outcome the test names and a `misdelivery_caught` audit entry. | **3 of 3.** M1: the address warning held the request; after **Send anyway**, `anna.huber` saw only Dr. Hofer and the clinic, was refused at login, and could not answer, and `identity_checked` with `fail` is in the log. M2: `thomas.wagner` was refused at login. M3: Max Beispiel's result was not filed, and Dr. Hofer got a notice in the room. Each wrote `misdelivery_caught`. |
| Audit coverage | 6 of 6 on request 1 | Check that request 1 has all six event types, each with who, what, and when: `request_sent`, `link_opened`, `identity_checked`, `answer_sent`, `answer_filed`, `misdelivery_caught`. `pnpm audit:check` lists them per request. | **6 of 6** on request 1 (`pnpm audit:check`). In that run the email was not sent yet. Since #4, ordy stores `request_sent` for an email request only after the SMTP server accepted the email. For an SMS request, `request_sent` commits together with the SMS on the SMS screen. |

## Documents

| Document | What it covers |
|---|---|
| [Whitepaper](docs/WHITEPAPER.md) | The problem, the solution, our answers to the five design questions, and how we measure the metrics |
| [Development](docs/DEVELOPMENT.md) | Set up, start, reset, and extend the stack; troubleshooting |
| [Deployment](docs/DEPLOYMENT.md) | Workspace hostname, proxy settings, HTTPS, and migration from Element on 8081 |
| [Architecture](docs/ARCHITECTURE.md) | Components, ports, the request lifecycle, the Matrix bot, messages, parsing, and the audit log |
| [eHVD](docs/EHVD.md) | The real eHVD SOAP interface, what is public about it, our mock, and how ordy uses it |
| [Identity and misdelivery](docs/IDENTITY.md) | Real ID Austria and eHVD, the Keycloak simulation, the identity checks, and the three misdelivery tests |
| [FHIR model](docs/FHIR.md) | The resources we file, how they reference each other, and how we validate them |
| [Demo script](docs/DEMO.md) | Draft click path for the 2-minute video |
| [Timeline](docs/TIMELINE.md) | Milestones, tasks, owners, and the cut list |
| [Compliance and safety](docs/COMPLIANCE_AND_SAFETY.md) | Synthetic data, message rules, data we keep, AI rules, and the disclaimer |
| [UML diagrams](docs/UML.md) | Use cases, domain classes, and component relations |
| [Track brief](track/README.md) and [scenario](track/scenario/README.md) | The task as the organisers wrote it |
| [UI prototype](prototype/ordy-app/README.md) | An early clickable design mock-up with simulated data. It is not the running app. |

## Disclaimer

> **Important notice.** This software is a prototype built for the AIM hackathon 2026. It is not a medical device, it has not been clinically validated, and no regulatory body has approved or certified it. It uses fictional, synthetic data only. ID Austria and the eHVD are simulated.
>
> Do not use it to diagnose, treat, or monitor any condition, or to make any clinical decision. Do not enter real patient data or any personal data. The authors accept no liability for any use outside the hackathon demonstration.
