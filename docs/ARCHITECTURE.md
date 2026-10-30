# Architecture

This page describes what runs, how the parts talk, and what the request service stores. [Whitepaper](WHITEPAPER.md) explains why.

## Components

| Component | What it does | Built or reused | Image or library | Port |
|---|---|---|---|---|
| Synapse | Matrix homeserver for `klinikum.example` | Reused | [`matrixdotorg/synapse`](https://hub.docker.com/r/matrixdotorg/synapse) | 8008 |
| Element Web | Dr. Hofer's chat client | Reused | [`vectorim/element-web`](https://hub.docker.com/r/vectorim/element-web) | 8081 |
| Request service (ordy) | Outside portal, widget, identity checks, parser, FHIR mapper, audit log, SMS screen | Built | TypeScript: [Next.js](https://nextjs.org/docs) 16 (App Router), [tRPC](https://trpc.io/docs) v11, [zod](https://zod.dev/), [Drizzle](https://orm.drizzle.team/), [openid-client](https://github.com/panva/openid-client) (T07), [markdown-it](https://github.com/markdown-it/markdown-it) (T10), [Nodemailer](https://nodemailer.com/) (T06), UI with [shadcn/ui](https://ui.shadcn.com/) on Tailwind CSS | 3010 |
| Matrix bot | Notices and `!status` in Dr. Hofer's room | Built | TypeScript process in `src/bot/`, small Matrix client on `fetch` in `src/server/matrix/client.ts` | none |
| Postgres | Requests, bindings, audit log | Reused | [`postgres:17-alpine`](https://hub.docker.com/_/postgres) | 5433, mapped to 5432 in the container |
| Simulated ID Austria | OpenID Connect login with fake citizens | Configured (T02) | [Keycloak](https://www.keycloak.org/server/containers) | 8080 |
| eHVD mock | Directory of healthcare people and organisations, same SOAP interface as the real eHVD | Built (T23) | TypeScript service on `node:24-alpine` with [`saxes`](https://github.com/lddubeau/saxes), in `services/ehvd-mock/`, see [eHVD](EHVD.md) | 8095 |
| Mailpit | Catches every outgoing email in local development. For the demo, email goes through Gmail SMTP as ordysoftware@gmail.com to the team inboxes instead, see [Outgoing messages](#outgoing-messages). | Reused | [`axllent/mailpit`](https://hub.docker.com/r/axllent/mailpit) | 1025 SMTP, 8025 web |
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
                               +--------------> Mailpit or Gmail SMTP (email), /sms page (SMS)
```

## Document types

One table in the request service, `DOCUMENT_TYPES` in `src/lib/document-types.ts`, defines each document type. To add a type, add a row there and here. The database stores the key as text, so a new type needs no migration.

| Key | Default channel | eHVD check | Mapper | Name in Matrix messages | Words no outgoing message may contain |
|---|---|---|---|---|---|
| `lab-result` | email | Release check: the physician under `Validated by` is active, has the lab medicine specialty, and is a member of the named organisation | Lab mapper: Observations and DiagnosticReport | lab result | `lab`, `labor`, `result`, `befund` |
| `rehab-report` | SMS | Release check: the physician under `Written by` is active and a member of the named organisation, which is an active hospital | Rehab mapper: DocumentReference | rehab discharge report | `rehab`, `discharge`, `report` |

## Request lifecycle

The request service stores each request with one state. The FHIR Task for the request mirrors the state. `src/server/requests/lifecycle.ts` holds both tables below as code, and `lifecycle.test.ts` tests every row.

| State | Meaning | Task status |
|---|---|---|
| `awaiting_confirmation` | The address check failed or could not confirm the address, and Dr. Hofer has not confirmed yet | `draft` |
| `sent` | The email or SMS went out | `requested` |
| `identity_held` | The identity check held: the name matched only partly, the requested name had no words, or the eHVD could not be reached. Dr. Hofer decides. | `on-hold` |
| `verified` | The identity check passed, and the outside person can answer | `in-progress` |
| `answer_held` | The answer arrived, but the eHVD could not confirm the role, and Dr. Hofer decides | `on-hold` |
| `filed` | The answer is on the FHIR server | `completed` |
| `cancelled` | Dr. Hofer cancelled the request | `cancelled` |
| `expired` | Nobody answered within 7 days | `failed` |
| `locked` | Three identity checks failed on this link | `failed` |

| Event | In code | From | To |
|---|---|---|---|
| Dr. Hofer sends the request form and the address check passes | `initialState(true)` | none | `sent` |
| Dr. Hofer sends the request form and the address check fails or cannot confirm the address | `initialState(false)` | none | `awaiting_confirmation` |
| Dr. Hofer clicks **Send anyway** | `send_anyway` | `awaiting_confirmation` | `sent` |
| Identity check passes | `identity_pass` | `sent` | `verified` |
| Identity check holds: partial name, requested name without words, or eHVD unreachable | `identity_hold` | `sent` | `identity_held` |
| Identity check fails for the third time | `identity_fail` | `sent` | `locked` |
| Dr. Hofer clicks **Accept** | `accept` | `identity_held` | `verified` |
| Answer passes the patient check and the role is confirmed | `answer_confirmed` | `verified` | `filed` |
| Answer passes the patient check and the role is not confirmed | `answer_unconfirmed` | `verified` | `answer_held` |
| Answer fails the patient check | `patient_mismatch` | `verified` | `verified` |
| Dr. Hofer clicks **Accept** | `accept` | `answer_held` | `filed` |
| Dr. Hofer clicks **Reject** | `reject` | `identity_held` or `answer_held` | `cancelled` |
| Dr. Hofer clicks **Cancel** | `cancel` | any open state | `cancelled` |
| 7 days pass | `expire` | any open state | `expired` |

The open states are `awaiting_confirmation`, `sent`, `identity_held`, `verified`, and `answer_held`. Any other pair of state and event is refused. `accepts(state, event)` reads the same table, and `REQUESTER_EVENTS` lists the four events Dr. Hofer triggers: `send_anyway`, `accept`, `reject`, and `cancel`. The widget imports both in the browser, so `lifecycle.ts` must not import server code at runtime.

**Accept** and **Reject** on `answer_held` go through the answer flow: Accept files the held answer, and the request becomes `filed` only if the FHIR server took it ([The answer](#the-answer)). Moving to `filed` without that would claim a filing that never happened.

A failed identity check does not change the state, so the real person can still answer a forwarded link. The failure goes to the audit log and to Dr. Hofer. If Keycloak cannot be reached, the check holds without a state change and does not count toward the lock. A login in any state other than `sent` changes no state. A hold stores the held person's bPK in `person_number`, and **Accept** keeps it, so only the accepted person can answer. [Identity checks](IDENTITY.md#identity-checks) has the details.

`failed_checks` counts every failed identity check while the link works, but only a `sent` request locks on the third one.

No job watches the expiry. Before the request service reads or changes a request, it sets that request to `expired` if it is open and past `expires_at`. Before it lists requests, it does the same for all of them (`expireDueRequests` in `src/server/requests/service.ts`). `applyEvent` in the same file locks the request row while it changes the state, so two events on one request never overlap. Its callback writes the audit entry for the change in the same transaction. It takes every event except a login's: `identity_pass`, `identity_hold`, and `identity_fail` go only through `applyLoginTransition` below, so a login always stores the bPK.

The login changes a request through the five ports that `runIdentityChecks` in `src/server/identity/login.ts` takes. `identityCheckPorts(db, notify)` in `src/server/requests/identity-ports.ts` builds them from the request service:

- `incrementFailedChecks` adds one to `failed_checks` in one statement and returns the new count.
- `applyLoginTransition` applies `sent` to `verified`, `identity_held`, or `locked` only while the request is still `sent` and not expired. It stores the bPK in the same statement. It returns false when the state changed in between, and it refuses a change the lifecycle table does not allow, such as a lock before the third failure. If a `sent` request already has three failures counted because the lock after the third one never ran, the next login locks it instead of passing or holding. It then returns false, and the person sees "try again" once and "This link does not work" after that.
- `findBinding` reads `bindings`. `recordAudit` parses the entry against the audit types before it writes it: `identity_checked` with `pass`, `hold`, or `fail`, or `misdelivery_caught` with `wrong_person`, each with check names, verdicts, and reason codes only. Anything else throws.
- The caller passes `notify`, because the thread of a request belongs to T05.

The link token and the 7 days start when the request goes out. **Send anyway** (`sendAnyway`) gives the request a new token and a new expiry and writes `request_sent` then, not when the request was created.

`request.create` runs the address check (`checkAddress` from `src/server/ehvd/address-check.ts`) before it stores the request:

- A pass is `sent`.
- A mismatch waits in `awaiting_confirmation`, and `misdelivery_caught` records `address_mismatch` with both domains.
- An address the eHVD could not confirm waits too, but with no audit entry: nothing was caught, and nothing went out. If Dr. Hofer sends it anyway, `request_sent` with `sentAnyway` and no `misdelivery_caught` before it shows that.

`create` returns `addressWarning`, the warning that belongs next to **Send anyway**, or null. `get` and `list` return it while the request waits. A mismatch is rebuilt from its audit entry; for an unconfirmed address they say only that the eHVD could not confirm it. `request.sendAnyway` sends a waiting request, and answers `CONFLICT` for any other state.

## Link rules

- The link token is 32 random bytes, encoded URL-safe. The database stores only its SHA-256 hash.
- The link is valid for 7 days. It accepts one filed answer.
- Three failed identity checks lock a link that is still `sent`. Dr. Hofer can send a new request. In the other states the failures are counted and logged, but only `sent` has a transition to `locked`.
- Until the identity check passes, the page shows only the requesting doctor and clinic.
- The link works in `sent`, `identity_held`, `verified`, and `answer_held`. An unknown, malformed, expired, cancelled, locked, or filed link shows the same "This link does not work" page.

## Widget

Dr. Hofer sends requests and makes every decision about them in the ordy widget. `pnpm matrix:bootstrap` pins it in her room. There are no chat commands for requests.

The widget uses `matrix-widget-api` to get a Matrix OpenID token from Element after the user approves identity sharing. It takes Element's origin from the `parentUrl` parameter that Element appends to the widget URL, because Element sends no referrer. The widget sends the token as `Authorization: Bearer` with every clinic tRPC call. Patient and audit data come only from `clinic.patients`, `clinic.audit`, and the `request` procedures, all protected by `clinicProcedure`; neither page embeds that data in its initial HTML or React server payload. Tokens and the clinic query cache stay in memory and are discarded on expiry or unmount. The widget includes an **Audit log** tab. The request service checks the token with Synapse (`verifyOpenIdToken` in `src/server/matrix/client.ts`). It accepts only users on its own homeserver, `MATRIX_SERVER_NAME`, which is `klinikum.example` in the demo. The checked Matrix ID is the actor in the audit log.

| Part of the widget | Effect |
|---|---|
| Request form | Creates a request and sends the email or SMS |
| **Send anyway** | Sends a request despite the address warning |
| **Accept** | Accepts a held identity, or files a held answer (`acceptAnswer`, see [The answer](#the-answer)) |
| **Reject** | Rejects a held identity, or deletes a held answer (`rejectAnswer`) |
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

If the address check fails, the widget shows the warning next to **Send anyway** and **Cancel**: "The address domain `labor-kanaI.example` does not match Labor Kanalstraße (`labor-kanal.example`)." If the eHVD cannot confirm the address, for example because it cannot be reached, the request waits the same way, and the widget says "The address did not pass the address check." The reason is in `addressWarning` from `request.create`, such as "The eHVD could not be reached, so the address could not be checked.", but the widget does not show it yet. [eHVD](EHVD.md#the-address-check) has every case.

## Matrix bot

The bot listens in rooms it has joined. It accepts commands from any Matrix user on `MATRIX_SERVER_NAME` and ignores everyone else (`src/bot/main.ts`). It has two commands. `!help` lists them, and `!status` checks the database, the FHIR server, and Matrix.

The request service posts notices in Dr. Hofer's room as the bot user, with `notifyRoom` in `src/server/matrix/notices.ts`. Each notice is a plain-text `m.notice`, never HTML, because the names in it come from Dr. Hofer's input and from ID Austria. The first notice of a request starts a thread, and the request service stores its event id in `requests.matrix_event`. Later notices go into that thread with an `m.thread` relation. Their reply fallback points to the first notice, so a client without threads shows them as replies to it.

| When | Notice |
|---|---|
| The request goes out | "Request 1 sent to Dr. Eva Brandl (Labor Kanalstraße) by email." |
| The name check fails (M1, M2) | "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address." |
| Another identity check fails, the name matched | "Request 1 was opened by Eva Brandl, but the identity check failed. The ID Austria login has only basic function, and a request needs full function. Nothing was shown or filed." |
| The patient check fails (M3) | "The answer to request 1 is about a different patient. Name and birth date do not match Maria Beispiel. Nothing was filed." |
| The name matches only partly | "Request 1 is on hold. The ID Austria name Petra Brandl matches Dr. Eva Brandl only in part. Accept or reject the person in the widget." |
| The release check does not pass | "The answer to request 1 is on hold. The eHVD does not list Dr. Eva Brandl as a member of Labor Kanalstraße. Accept or reject the answer in the widget." |
| The answer is filed | "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range." |

The caller writes the reason sentence of a held notice and of a failed identity check whose name matched. A filed lab result with values outside the reference range says how many, for example "4 values, 1 outside the reference range." A rehab discharge report has no values, so its filed notice ends after "Identity checked with ID Austria."

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

`sendRequestEmail` in `src/server/mail/send.ts` renders the email and sends it over SMTP with Nodemailer. The email is plain text with no HTML part. The requester's name is a Matrix display name that the member sets themselves, so it never goes into HTML. The expiry date is the day in the `Europe/Vienna` time zone. Nothing calls it yet. `request.create` and `sendAnyway` still print the link in development (`TODO(T06)` in `src/server/api/routers/request.ts`), and a follow-up sends it there.

Locally every email goes to Mailpit, which catches any address. For the demo, it goes through Gmail as ordysoftware@gmail.com, on `smtp.gmail.com` port 465 with TLS from the start. The scenario's `.example` addresses cannot receive mail. With `MAIL_TEAM_INBOXES` set, every email goes to the team inboxes instead of the request's address. The `To` header still names the request's address, so the email for request 1 reads as sent to `eva.brandl@labor-kanal.example`. If `SMTP_USER` is set and `MAIL_TEAM_INBOXES` is empty, the request service sends nothing. A real relay would deliver to any address typed in the widget. [Development](DEVELOPMENT.md#send-email-through-gmail) has the setup.

Before sending, the request service compares the words of the subject and the text with three kinds of forbidden words:

- the patient's name words
- the birth date in the formats `1961-03-12`, `12.03.1961`, and `12 March 1961`
- the words of every document type in the table above, not only the requested one

It compares whole words, not substrings. A substring check would block every message, because the patient's family name "Beispiel" is part of "Klinikum Beispielstadt".

A word is a run of digits and letters that have an upper and a lower case, such as Latin, Greek, or Cyrillic letters. Every other character separates words. So "Maria's", "(Maria)", and "maria.beispiel" all contain the word "maria". Case does not matter. The Turkish dotless ı counts as i, and the Greek final sigma ς counts as σ. Umlauts are spelled out (ü as ue), also with a tone mark as in "Lǚ". Other accents and marks that join the letter before them are dropped, so they do not split a word. A name word of one letter, such as the initial "R.", does not count. One letter names nobody, and every link has the word "r". A number loses its leading zeros. A birth date counts as its sequence of words, so `12.3.1961` and `12/03/1961` match `12.03.1961`. The check cannot find whole words in a script without case, such as Chinese. So if a patient's name has a letter without case, the check refuses every email for that patient. Modifier letters, such as the apostrophe ʼ in "Лукʼян", do not count.

On a hit, nothing is sent. `MessageRefused` names only the kinds of data it found: `patient-name`, `birth-date`, or `document-type`. It never names the words, so logging the error cannot leak the patient's name. The link token is random, so in rare cases it holds a forbidden word between `-` or `_`. The email is then refused too. A given name that is also an English month, such as August, refuses the email when the link expires in that month. Avoiding that needs a change to the template, which Doc 1 approves. [Compliance and safety](COMPLIANCE_AND_SAFETY.md) has the rule.

## Outside portal

| Route | What it does |
|---|---|
| `GET /r/{token}` | Writes `link_opened`. Shows the requesting doctor and clinic and a **Log in with ID Austria** button. |
| `POST /auth/login` | The landing page's form posts here. Redirects to Keycloak with `state`, `nonce`, PKCE, and `prompt=login`. |
| `GET /auth/callback` | Swaps the code for tokens, verifies the ID token, ends the Keycloak session, runs the identity checks, and sends the person to the page for the result. Stores the ID token on the request and sets the session only for the person the request is bound to. |
| `GET /auth/failed` | Says the login has expired and asks the person to open the link again. |
| `GET /r/{token}/answer` | Shows the patient, the requested document, the upload field, and fields for the patient's name and birth date. Only while the request is `verified`, and only for the person whose person number the request stores. For that person, a held request shows "Thank you, your document arrived" and a filed one "Thank you, your document is filed". Without a session for this link it goes back to `GET /r/{token}`. Anyone else gets "This link does not work". |
| `portal.answer` (tRPC, the answer page's upload) | Writes `answer_sent`, parses the document, runs the patient check and the release check, files the resources, and writes `answer_filed`. See [The answer](#the-answer). |
| `GET /r/{token}/held` | Where the login sends a held person: "This request needs a check". The same page for every link. |
| `GET /r/{token}/refused` | Where the login sends a person who failed the identity check: "This request is for someone else. Nothing was shared with you." The same page for every link. |
| `GET /r/{token}/unavailable` | Where the login sends a person when ID Austria could not be reached: "The login could not be finished" and a **Try again** link. |
| `GET /sms` | Shows every SMS the request service would have sent, like a phone screen. |
| `GET /audit` | Audit UI; data requires a verified Matrix clinic identity. Use the widget's **Audit log** tab in Element. |

The pages are Next.js routes. `/auth/login` and `/auth/callback` are route handlers, because they need real redirects and cookies. The answer page loads its data and sends the upload through tRPC (`eidProcedure`, the upload as `FormData`).

After the login, a signed session cookie (`ordy_eid_session`, see `src/server/auth/eid-session.ts`) holds the request id, the person number (the bPK, never `sub`), the names, the function level, and the eHVD OID. It expires after 30 minutes. The ID token stays on the server, on the request row. During the login, a second signed cookie, `ordy_eid_login`, carries `state`, `nonce`, and the PKCE verifier to the callback. [The login for T07](IDENTITY.md#the-login-for-t07) has the details.

`portalPath(token, page)` in `src/server/portal/paths.ts` maps each result of `runIdentityChecks` to its page: `answer` to `/r/{token}/answer`, `held` to `/held`, `wrong_person` to `/refused`, `unavailable` to `/unavailable`, and `closed` to `/r/{token}`, which shows "This link does not work". Only the answer page shows the patient and the document type.

### The answer

The answer page posts `FormData` with the link token, the file, and the patient's name and birth date to `portal.answer` (`eidProcedure`). The token must belong to the session's request, so another site cannot post an answer with the session cookie alone. `submitAnswer` in `src/server/answers/submit.ts` then runs these steps:

1. The request must be `verified` and bound to the session's person number, and `requests.id_token` must be a token whose `urn:pvpgvat:oidc.bpk` is that person number. Otherwise the sender gets "This link does not work" or "Log in again", and nothing is logged.
2. `answer_sent` with the SHA-256 and the size of the upload.
3. The file must be UTF-8 text of at most 64 KB without control characters (C0, DEL, and C1) other than tab and line breaks, no line may be longer than 1,000 characters, and the parser must read it. The scenario documents are about 2 KB with lines of at most about 200 characters. The line limit comes first because the parser's line patterns take time that grows with the square of a line's length. Otherwise the sender gets the reasons and can upload again. The route reads every request body up to a limit before tRPC sees it: an upload up to 64 KB plus the form fields, any other body up to 64 KB (`withUploadLimit` in `src/server/api/upload-limit.ts`).
4. The patient check on the document and on the form. A document about someone else is the `patient_mismatch` event: `misdelivery_caught` with the hash and whether the document's name and birth date matched, the M3 notice to Dr. Hofer, and the upload is discarded. The sender gets "This document is about a different patient. Check the file and upload again." When the document is right and only the typed name or birth date is wrong, nothing was misdelivered: the sender gets "The name or birth date you entered does not match the patient of this request.", and nothing beyond `answer_sent` is logged or sent to Dr. Hofer.
5. The document kind must be the requested document type. A rehab report sent for a lab request is refused with the reason, and nothing is kept.
6. The release check (`checkRelease`, T15). A hold is the `answer_unconfirmed` event: the answer goes into `held_answers`, Dr. Hofer gets the held notice with the check's sentence, and the sender gets "Thank you, your document arrived". An error in the check is a hold too, never a pass.
7. A pass is the `answer_confirmed` event. The request row stays locked while the FHIR transaction runs, and the state `filed`, `answer_filed`, and the person number binding commit only if the FHIR server took the whole answer. Two uploads at the same time file once. Dr. Hofer gets the filed notice, and the sender "Thank you, your document is filed". If the FHIR server refuses the answer, nothing changes, and the sender can send again. If the outcome is unknown, for example after a timeout, the server may have filed it ([Retries](FHIR.md#retries)). The answer then goes into `kept_answers` while the row is still locked, and until it is filed, or the server refuses it, the request takes no other upload: the next send files the kept answer exactly as it was, with no new eHVD lookup and no new parse, and does not read the new file. In both cases the sender gets "The document could not be filed right now. Send it again in a few minutes." A send with another file while an answer is kept gets `earlier_answer`: "Thank you, your earlier document is filed" or "Your earlier document is still being filed", and in both cases "The file you just chose was not read." An answer about to be held also yields to an answer kept in between. A filed or otherwise closed request keeps no ID token: `applyEvent` and expiry clear `id_token`.

`acceptAnswer` in `src/server/answers/held.ts` files a held answer when Dr. Hofer clicks **Accept** in the widget (`request.accept` on `answer_held`), with the policy `accepted-by-requester` and her Matrix ID in `request_decided` and as `acceptedBy` in `answer_filed`. The Organization and the responsible person carry the eHVD OIDs the release check found before it held, if any. **Reject** (`request.reject`) is the `reject` event through `rejectAnswer`, which deletes the answer and writes `request_decided`. Both take the Matrix ID of the member who clicked, and do nothing unless it is the one who sent the request and the request is `answer_held`. If the request turns `answer_held` while a plain Accept or Reject runs, the router refuses it with a conflict, so a held answer is never filed or dropped past the answer flow. An Accept whose filing outcome is unknown keeps the answer as in step 7: the request stays held, the next Accept files exactly that answer, and Reject is refused ("Click Accept again") until it is filed or refused. `applyEvent` deletes the held answer whenever a request leaves `answer_held`, and expiry deletes it too.

The release check and the mappers are passed in (`src/server/answers/ports.ts`, `answerDeps` in `deps.ts`). The filing is `fileAnswer` from T13, through `fhirFiling` in `fhir-filing.ts`. It passes its own `audit`, because `fileAndRecord` writes `answer_filed` in the database transaction that sets the request to `filed`. `fhirFiling` throws `NotFiled` when the Bundle was never sent or HAPI refused it; any other error leaves the outcome open. `mapClinical` there runs the lab or the rehab mapper (T12, T14). The release check is `checkRelease` from T15 (`src/server/ehvd/release-check.ts`) against the eHVD from `EHVD_URL`.

## Document parsing

The scenario documents share one Markdown format:

- a heading `# <Organisation>: <document kind>`, for example `# Labor Kanalstraße: lab report`
- `Key: value` lines such as `Patient`, `Sample taken`, `Reported`, `Stay`, `Validated by`, `Written by`, and `Sent by`
- for lab results, a table with the columns `Test`, `Result`, `Unit`, `Reference range`, and `LOINC code`
- free text sections such as `## Course` and `## Recommendations`

The parser reads headings and tables from markdown-it tokens and splits `Key: value` lines at the first `": "`. It reads dates against a fixed list of formats in the `Europe/Vienna` time zone, for example `22 October 2026, 08:10`. The `Patient` line splits at `", born "` into name and birth date.

The document kind picks the mapper. `lab report` goes to the lab mapper and `discharge report` goes to the rehab mapper. The parser reads any other kind as a generic document. The answer flow takes only the kind the request asked for, so it refuses a generic document with the reason, and nothing is kept.

The parser lives in `src/server/documents/`. `parseDocument()` returns a typed `LabResult`, `RehabReport`, or generic document (`types.ts`), or a list of reasons the uploader can act on; it never throws on content and never returns a half-read document. It refuses a document without a heading or a readable `Patient` line, a known key on more than one line with different values (a second `Patient` line could slip past the patient check), a lab report without exactly one result table, a result that is not a number (also `1,245`, which could mean 1245 or 1.245), a LOINC code with a wrong format or check digit, a vital sign row FHIR cannot file (blood pressure, a vitals panel, venous or capillary sO2) or with a unit its FHIR profile does not allow, and a missing or unreadable date or stay line that the kind needs. It also refuses a file whose lines name more than one patient or birth date in any written form, such as a bold `**Patient:**` line (`patient-lines.ts`). A refused result lists the refusals that stop a misdelivery in `safety` (see the AI fallback below). Inside a `##` section only known keys such as `Written by` count, so a sentence with a colon stays text. Outside the sections a line with an unknown key such as `Note:` is a field and free text, so it still reaches the conclusion. The conclusion of a lab report is all its free text: the lines outside sections, `###` headings, a second `#` heading, code blocks, and each `##` section as `Heading: text`, so a comment such as `## Comment` is not lost. In a rehab report a `###` heading or a code block inside a `##` section becomes part of that section's text in the same way. A byte order mark at the start is ignored. Person lines split off titles such as `Dr.`, `Dr.in`, or `Prim.` with the same rule as `nameWords`. It codes the units on its list in `ucum.ts` in UCUM, for example `10^9/L` as `10*9/L` and `µmol/l` as `umol/L`, and leaves any other unit as text; it computes `N`, `H`, or `L` from the reference range, and reads a stay that names the month once, twice, or crosses a year. `checkAnswerPatient()` in `patient-check.ts` runs `samePatient()` on the document and on the form. A patient record without a family name or birth date never matches. `uploadHash()` gives the SHA-256 that stays in the audit log when an upload is discarded.

`extra.test.ts` runs our extra test documents from `track/scenario/extra/` through the parser and the patient check ([Development](DEVELOPMENT.md#extra-test-documents)). Their index lists the gaps the parser still has, such as one-sided ranges like `< 5`.

### AI fallback (optional, cut first)

If the parser cannot read a document, the AI fallback may read it. It follows one rule: code decides everything that carries safety or meaning, and the model never chooses a value. The patient check stays deterministic. An answer the fallback reads always waits until Dr. Hofer accepts it in the widget.

`parseWithFallback()` in `src/server/documents/fallback.ts` runs `parseDocument()` first. It goes on only when that fails for its format and a reader is configured. The reader in `anthropic-reader.ts` calls the Anthropic Messages API with structured outputs (`AI_FALLBACK_MODEL`, default `claude-opus-5-5`). It uses no server-side fallback model, so the model named in the README is the only one that reads a document. Without `ANTHROPIC_API_KEY` the fallback is off. Tests inject a stub reader and never call the network.

**Safety refusals never go to the model.** They exist to stop a misdelivery, not because the format is unknown. `parseDocument()` marks them in `safety` on its failure result, and the fallback runs the same checks on formats the parser does not know:

- `repeated-key`: a key that the reader reads as a field on more than one line with different values, such as a second `Patient:` line. Two `Note:` lines are text, not a refusal.
- `several-tables`: more than one table
- `several-patients`: lines that name different patients
- `several-birth-dates`: lines that give the patient different birth dates

`patient-lines.ts` finds the patient lines and birth date lines wherever they are written: plain text, a heading, bold or italic keys, list items, link text, a code block, or HTML, with a colon, a fullwidth colon, or a dash as the separator, with or without a space after it, with curly apostrophes, and with a suffix such as `(2)`. `Patient`, `Patient name`, and similar keys name the patient anywhere in the file. `Name`, `Full name`, `Born`, and the pair `First name` and `Surname` count only in the header block; further down, `Name: Stefan Kern` under `## Contact` is a contact and `Born: in Linz` under `## History` is a sentence. One rule, `headerBlock()`, defines the header block for every reader: it runs from the start of the file up to the first table, or up to the first heading after the `#` title that does not open the patient's details. A `## Patient`, `## Patient data`, or `## Patient details` section belongs to it, so `## Patient` followed by `Name: Maria Beispiel` names the patient, and a second such section with another name is refused. A heading before the title does not end it, so `### Ref 123` before the title cannot push a `Name: Max Beispiel` line out of it. Below the header block, such a line is not counted as a patient line; it stays visible as text, in the conclusion or its section, and the patient check runs on the patient line of the header block. This known gap is listed in #46 with the other forms the scan does not find yet. Birth date keys are `Date of birth`, `Birth date`, `DOB`, and similar; `Mother's date of birth` is not one. The parser runs this scan too, so `**Patient:** Max Beispiel` next to Maria's line is refused there as well. Forms the scan does not find yet, such as a `| Patient | Max Beispiel |` row in a key/value table, are listed in #46 too.

**Code reads the document** with synonyms for keys and column headers (`readWide()`, not exported):

- The patient name is the whole value of the one patient line, cut only before a birth clause such as `, born 12 March 1961` or `, DOB 12.03.1961`. A line with anything else after a comma, such as `Beispiel, Max` or `Maria Beispiel, Max Beispiel`, gives no record, so a name is never cut short to one that passes the patient check. `First name` and `Surname` lines in the header block give the name when there is no patient line. The birth date is the one date that the patient line and the birth date lines give.
- Text or a heading before the `#` title gives no record. The parser takes the first `#` heading wherever it is, but the fallback does not guess which part of such a file is the document.
- The type comes from the kind in the heading: `lab report` and similar kinds give a lab result, `discharge report` and similar kinds give a rehab report. A table under any other kind gives no record.
- Each key field comes only from its own keys, for example `Sample taken`, `Collected`, or `Collection date` for `sampleTaken`. A field found on two lines with different values gives no record.
- Each lab field comes from the one column whose header names it, for example `Result` or `Value`, never `Previous`. A field with no such column, or with two, gives no record. Every body row becomes a lab row.
- Ranges such as `0.8 to 1.2`, `0.8 - 1.2`, `25 – 37`, `25 — 37`, or `25 − 37` are read. A written range that cannot be read, such as `< 37` or `25 bis 37`, gives no record, so a value outside it never passes as normal. A result that is not a number, a LOINC code with a wrong check digit, or a vital sign row the parser refuses gives no record either. Units get UCUM codes as in the parser (`rowUnit()` in `parse.ts`).
- The conclusion is all the free text, built the same way as in the parser, and the sections are the `##` sections.
- Dates may also be written `12.03.1961`, `1961-03-12`, or `22.10.2026 08:10`.

If code cannot read the file, the model is not called and the uploader gets the reasons.

**The model is a second reader.** It reads the same document on its own and returns the fields that carry meaning (`modelReadingSchema`): type, organisation, kind, patient name and birth date, the key fields, and every lab row as written. Its reading must agree with code's in each of them: the same text, white space aside, and the same birth date. If it agrees, the record is code's record, held. If it does not, nothing is filed from it, and `held.unverified` lists the model's values that differ. The model can stop a record but never change one.

| Outcome | Result | What happens |
|---|---|---|
| The parser reads the file | `{ ok: true, document }` | Normal flow, the model is not called |
| A safety refusal, from the parser or from the fallback | `{ ok: false, errors, safety }` | As without the fallback, the model is not called |
| No key, or code cannot read the file | `{ ok: false, errors, safety: [] }` | As without the fallback, the model is not called |
| The model call fails, or its answer does not fit the schema | The parser's `{ ok: false, errors, safety: [] }` | As without the fallback |
| The model's reading agrees with code's | `{ ok: true, document, held }` | Held for Dr. Hofer with the record |
| The model's reading differs from code's | `{ ok: false, errors, held }` | Held for Dr. Hofer with the file only. `held.unverified` lists the differing values |

`held.reason` goes into the held notice and names no document content. `held.unverified` quotes the model's values, so it may appear in the widget but never in Matrix or the audit log. Accepting or rejecting a held answer is the widget's job (T05). Wiring the fallback into the upload is part of the answer flow, which calls `parseWithFallback(markdown, anthropicReader())` in place of `parseDocument(markdown)`. The test fixtures in `src/server/documents/fixtures/` are Maria's lab result and rehab report with another heading, other key and column names, dotted dates, and ranges written with `-`.

## Storage

The request service keeps five Postgres tables, defined with Drizzle in `src/server/db/schema.ts`. Migrations live in `drizzle/`.

| Table | Columns |
|---|---|
| `requests` | `id`, `doc_type`, `patient_id`, `given`, `family`, `org`, `channel`, `address`, `requester`, `requester_name`, `state`, `link_hash`, `failed_checks`, `person_number`, `id_token`, `created_at`, `expires_at`, `matrix_room`, `matrix_event` |
| `held_answers` | `request_id`, `markdown`, `sha256`, `sender`, `id_token`, `reason`, `organisation_oid`, `practitioner_oid`, `sent_at` |
| `kept_answers` | `request_id`, `answer`, `failed_at` |
| `bindings` | `given`, `family`, `org`, `person_number`, `practitioner_id`, `first_verified_at` |
| `audit_log` | `id`, `at`, `event`, `request_id`, `actor_kind`, `actor`, `outcome`, `detail` |

In `requests`, `patient_id` is the FHIR Patient id, and `given`, `family`, and `org` are the person as Dr. Hofer typed them. `requester` is the Matrix ID of the network member who sent the request, and `requester_name` is their Matrix display name at that time, for example "Dr. Lena Hofer", as one line of at most 100 characters. The portal and the messages use it. Members set their display name themselves, so one member could pose as another in a message; the audit log always keeps the Matrix ID. A production version takes the name from a directory the members cannot edit, or sets `enable_set_displayname: false` in Synapse. `link_hash` is the hex SHA-256 of the link token. `person_number` is the bPK of the person who passed the identity check, or who was held; after **Accept** it names the accepted person. Only that person sees the answer page and may answer. `id_token` is the ID token of that person's login, exactly as received, for the Provenance signature; the login stores it with `saveIdToken` only for the bound person, and the answer flow files only with a token whose bPK is `person_number`. A closed request keeps none: `applyEvent` and expiry clear it, and a filed answer carries it in the Provenance. `matrix_room` and `matrix_event` hold the room and the first notice of the request's thread (T05).

`held_answers` keeps an answer that passed the patient check while the release check holds it: the text, its SHA-256, the sender's name and eHVD OID from the login, their ID token, the reason Dr. Hofer got, and the eHVD OIDs of the organisation and the responsible person the release check found before it held, for **Accept**. It exists only while the request is `answer_held`. **Accept** files it, and **Reject**, **Cancel**, and expiry delete it. An answer for the wrong patient never gets here.

`kept_answers` keeps an answer whose filing outcome is unknown, so a retry files exactly it ([The answer](#the-answer), step 7). `answer` is everything the Bundle is built from: the parsed document, the parties with their eHVD OIDs and the Practitioner id from `bindings`, the ID token, the send time, the upload hash, and the Provenance sentences. It exists only while the request is `verified` or, after an **Accept** with an unknown outcome, `answer_held`. Filing it, a refusal by the FHIR server, **Cancel**, and expiry delete it.

`bindings` remembers which ID Austria person number answered as a given person at a given organisation. Its key is `given`, `family`, and `org`, so each person at an organisation has one person number. The first filed answer stores it, with the sender's Practitioner id when the eHVD does not list them. The audit log never holds document text.

`src/server/requests/service.ts` is the only code that writes `requests`: `createRequest`, `sendAnyway`, `applyEvent`, `incrementFailedChecks`, `applyLoginTransition`, `expireDueRequests`, and `saveIdToken`, which the login callback calls for the bound person. After each state change commits, `mirrorTask` PUTs the request's FHIR Task with the status from the lifecycle table ([FHIR](FHIR.md#task)); the filing Bundle writes the `completed` Task itself. The tRPC router `request` (`create`, `get`, `list`, `cancel`, `sendAnyway`, `accept`, `reject`, all `clinicProcedure`) and the portal pages use it. A network member sees and changes only the requests they sent; for anyone else, `get`, `cancel`, `sendAnyway`, `accept`, and `reject` answer "not found", and `list` leaves the request out. `get` and `list` return each request's audit entries, which name the outside person and their person number. `accept`, `reject`, and `cancel` write `request_decided` in the transaction that changes the state; on a held answer, `accept` and `reject` go through the answer flow ([The answer](#the-answer)). `sendAnyway` writes `request_sent`. The widget's **Audit log** tab (`clinic.audit`) still shows the whole log to every network member, for the demo.

## Audit log

| Event | Who | Outcome | What |
|---|---|---|---|
| `request_sent` | Dr. Hofer's Matrix ID | `sent` | Document type, channel, recipient address, and whether Dr. Hofer clicked **Send anyway** |
| `link_opened` | An anonymous browser, named by a keyed hash of its IP address from `X-Forwarded-For` | `shown`, or `refused` when the link no longer works | Request id and its state |
| `identity_checked` | The ID Austria name and person number, or `ID Austria login` when Keycloak could not be reached | `pass`, `hold`, or `fail` | The reason for each check |
| `answer_sent` | The verified person | `received` | SHA-256 and size of the upload |
| `answer_filed` | The request service | `filed` | FHIR resource ids and the Provenance id, `sha256` of the filed upload, and `acceptedBy`, the Matrix ID of the network member who accepted a held answer |
| `misdelivery_caught` | Whoever triggered it | `address_mismatch`, `wrong_person`, or `patient_mismatch` | The two domains, the failed checks, or the upload's SHA-256 and which part of the patient did not match |
| `request_decided` | Dr. Hofer's Matrix ID | `accepted`, `rejected`, or `cancelled` | The state before and after the decision |

The jury counts the first six, the track events from the track README ("Audit coverage"). `request_decided` is ordy's own: it records who accepted, rejected, or cancelled a request and when, as [Compliance and safety](COMPLIANCE_AND_SAFETY.md#identity-rules) requires. `pnpm audit:check` and `pnpm scenario` leave it out, so audit coverage stays 6 of 6. **Send anyway** writes no `request_decided`, because its `request_sent` already names Dr. Hofer.

Every entry has a UTC timestamp in `at`. The `outcome` column holds the short result: `pass`, `hold`, or `fail` for `identity_checked`, the kind for `misdelivery_caught`, and the decision for `request_decided`. The What sits in `detail`, with these fields. `pnpm audit:check` requires them for the six track events:

| Event | `detail` fields |
|---|---|
| `request_sent` | `docType`, `channel`, `address`. Also `sentAnyway`, which `pnpm audit:check` does not require: true after **Send anyway**. Without a `misdelivery_caught` before it, the eHVD had not confirmed the address. |
| `link_opened` | `state` |
| `identity_checked` | `checks`, one entry per check with its result and reason |
| `answer_sent` | `sha256`, `size` |
| `answer_filed` | `resources` (every filed resource as `Type/id`, which `pnpm validate` reads), `provenance` |
| `misdelivery_caught` | `address_mismatch`: `domain`, `expectedDomain`. `wrong_person`: `checks`. `patient_mismatch`: `sha256`, `size`, `nameMatches`, `birthDateMatches`. |
| `request_decided` | `from`, `to`: the request states before and after |

The widget and `GET /audit` show the entries.

`recordAudit()` in `src/server/audit/record.ts` writes the entries. Its types fix the outcome and the detail fields for each event and each misdelivery reason, and they hold ids, hashes, and check results only, never document text or the data of a wrong patient. An entry that belongs to a state change goes into the same transaction. A login is the exception: `runIdentityChecks` writes its entries through the port before it applies the state change, so `identity_checked` can record a pass whose change was refused, for example by the forced lock. `answer_filed` also names `output`, `targets`, `task`, `sender`, `author`, and `organization` (`AnswerFiled` in `src/server/fhir/file-answer.ts`). `fileAnswer` (T13) still inserts it directly until it switches to `recordAudit()`.

The IP hash is an HMAC-SHA256 with a key derived from `ORDY_SECRET`, cut to 16 hex characters, because a plain hash of an IPv4 address can be reversed by trying all of them. Without a private `ORDY_SECRET`, the entry says `ip unknown` instead. Next.js fills `X-Forwarded-For` from the connection only when the client sent none. Without a proxy in front, the client can set it, so the hash is a hint, not proof.

## Configuration

Configuration is read in `src/env.ts`. Service addresses and demo accounts have defaults. Outside-person sessions require a private `ORDY_SECRET`; an empty, short, or known placeholder key cannot sign or authenticate sessions. Setup generates a random key and preserves it across reruns. `.env.example` lists the variables.

| Variable | Default |
|---|---|
| `PUBLIC_URL` | `http://localhost:3010` |
| `CLINIC_NAME` | `Klinikum Beispielstadt`, named in the portal and in every email and SMS |
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
| `EHVD_URL` | `http://localhost:8095/` |
| `SMTP_HOST`, `SMTP_PORT`, `MAILPIT_API_URL` | `localhost`, `1025`, `http://localhost:8025`. Port 465 uses TLS from the start. Any other port upgrades with STARTTLS when the server offers it, and requires it when `SMTP_USER` is set. |
| `SMTP_USER`, `SMTP_PASSWORD` | empty, no login, which is what Mailpit wants. For Gmail: `ordysoftware@gmail.com` and an app password. |
| `MAIL_FROM` | `ordy · Klinikum Beispielstadt <ordy@klinikum.example>` |
| `MAIL_TEAM_INBOXES` | empty, so the email goes to the request's address, which is safe only with Mailpit. Comma-separated addresses; required when `SMTP_USER` is set. |
| `ANTHROPIC_API_KEY` | unset, only for the optional AI fallback; unset turns it off |
| `AI_FALLBACK_MODEL` | `claude-opus-5-5` |

The eHVD mock's `EHVD_ALLOWLIST` and `EHVD_SCHEMA_ERRORS` are read only by its container, so they live in `docker-compose.yml` and `.env.example`, not in `src/env.ts`. See [eHVD](EHVD.md#configuration).

To switch to real ID Austria, change `OIDC_METADATA_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`. The simulator already sends the real claim names, which [Identity and misdelivery](IDENTITY.md) lists.

## Repository layout

Files marked *planned* do not exist yet. The task id says who builds them.

```
docker-compose.yml            Synapse, Element, HAPI, Mailpit, Postgres, Keycloak, eHVD mock
.env.example                  all variables with demo values
docker/element/config.json    Element config
docker/synapse/               generated homeserver.yaml (git ignores it)
docker/keycloak/idaustria-sim-realm.json   simulated ID Austria: client, mappers, test citizens
docs/ehvd/eHVD.wsdl           the real eHVD WSDL, version 2 from BRZ
docs/clinical-review/         review files the clinicians fill in by hand, one per issue
services/ehvd-mock/           eHVD mock service and its synthetic directory (T23)
  src/                        SOAP wire format, field rules, queries, directory, HTTP server
  test/                       tests over real HTTP, run by pnpm test
  Dockerfile.dockerignore     keeps the image's build context to the files it needs
  Dockerfile                  image built from the repository root
drizzle/                      generated SQL migrations
src/
  env.ts                      zod-validated configuration
  app/                        Next.js pages and route handlers
    api/trpc/[trpc]/route.ts  tRPC endpoint
    api/healthz/route.ts      health check for scripts and containers
    widget/                   request form, request list, and decisions inside Element (T05)
    r/[token]/                outside portal: landing page, answer page, and the held, refused, and unavailable pages (T09)
    auth/                     ID Austria login and callback route handlers, expired-login page. The callback runs the identity checks (T08)
    sms/page.tsx              SMS screen, a stub. No task builds the SMS log, because T06 sends email only
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
    requests/                 request lifecycle, link tokens, the request service, mirrorTask for its FHIR Task, and notifyRequest for its notices
    answers/                  the answer flow: submitAnswer, acceptAnswer, rejectAnswer, fhirFiling, and the ports for the release check and the mappers (T09)
    audit/record.ts           recordAudit() for the six track audit events and request_decided
    fhir/                     FHIR client, the filing (T13), lab and rehab mappers (T12, T14)
    documents/                parser and patient check (T10, T11), typed records in types.ts, UCUM and vital sign lists, AI fallback (T22), the scenario documents as parsed records for tests
    identity/names.ts         name words, subset and shared-word tests from Identity, shared by the patient check and T08
    identity/checks.ts        identity checks at login: level, name, person number, eHVD claim (T08)
    identity/login.ts         what a check result does: state, audit entries, page, notice, and runIdentityChecks for the callback (T08)
    ehvd/oid.ts               OID check shared by the login and pnpm citizen
    ehvd/client.ts            eHVD SOAP client (T15), with soap.ts for the messages and xml.ts for the parser
    ehvd/address-check.ts     address check before sending (T15)
    ehvd/release-check.ts     release check when an answer arrives (T15)
    fhir/filing.ts            one answer as a transaction Bundle with Provenance and Task; fhir/file-answer.ts posts it (T13)
    matrix/client.ts          Matrix client-server API
    matrix/notices.ts         notice texts and notifyRoom for Dr. Hofer's room
    metrics/                  metrics from audit rows, validator runner, metrics table (T17, T18)
    mail/message.ts           request email template and the content check (T06)
    mail/send.ts              sendRequestEmail over SMTP: Mailpit, or Gmail to the team inboxes (T06)
    auth/eid-session.ts       outside person's session cookie and login cookie
    auth/id-austria.ts        OpenID Connect login: discovery, code swap, Keycloak logout, claims for the identity checks
    portal/data.ts            data loaders for the portal, the login, and the SMS page. The SMS log is a stub; T06 sends email only
    portal/answer-page.ts     what the answer page shows for a session: the form, held, filed, or closed
    portal/paths.ts           the portal page for each login result
  bot/                        Matrix bot process and commands
scripts/
  setup.sh                    one-time setup
  reset.sh                    empty Postgres, HAPI, and Mailpit, reload the patient
  bootstrap-matrix.ts         room, invites, widget
  seed-fhir.ts                Maria Beispiel into HAPI
  citizen.ts                  add a test citizen to the simulated ID Austria
  validate.ts                 HL7 validator on every filed resource or on given files (T18)
  audit-check.ts              six event types per request, each with who, what, and when (T17); --effort for the timed test (T19)
  scenario.ts                 request 1, M1 to M3, request 2, and the four metrics in one run (T17, T18)
  clinical-review-export.ts   the filing Bundles for the clinical review in docs/clinical-review/19-fhir/ (#19)
track/                        track brief, scenario, patient.json, test documents, and our extra set in scenario/extra/
```

## Run it

[Development](DEVELOPMENT.md) has the full guide. In short:

1. `./scripts/setup.sh` once. It creates `.env`, starts the containers, registers the Matrix users, migrates the database, loads the patient, and creates Dr. Hofer's room with the widget.
2. `pnpm dev` starts Next.js on `http://localhost:3010` and the bot.
3. Open Element at `http://localhost:8081` and log in as `lena.hofer` / `hofer-demo-2026`. The room "Dr. Hofer · Outside documents" is there. Send `!status`.
4. Mailpit is at `http://localhost:8025`. The SMS screen at `http://localhost:3010/sms` is a stub.

## Sources

- [Synapse](https://github.com/element-hq/synapse) and [Element Web](https://github.com/element-hq/element-web)
- [Keycloak: importing and exporting realms](https://www.keycloak.org/server/importExport) and [server administration guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
- [openid-client](https://github.com/panva/openid-client)
- [Next.js documentation](https://nextjs.org/docs), [tRPC](https://trpc.io/docs), [Drizzle ORM](https://orm.drizzle.team/docs/overview)
- [Mailpit](https://mailpit.axllent.org/)
- [HAPI FHIR JPA server starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
