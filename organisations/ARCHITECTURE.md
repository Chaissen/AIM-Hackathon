# Architecture

This page describes what runs, how the parts talk, and what the request service stores. [Whitepaper](WHITEPAPER.md) explains why.

## Components

| Component | What it does | Built or reused | Image or library | Port |
|---|---|---|---|---|
| Synapse | Matrix homeserver for `klinikum.example` | Reused | [`matrixdotorg/synapse`](https://hub.docker.com/r/matrixdotorg/synapse) | 8008 |
| Element Web | Dr. Hofer's chat client | Reused | [`vectorim/element-web`](https://hub.docker.com/r/vectorim/element-web) | 8081 |
| Request service | Matrix bot, outside portal, identity checks, parser, FHIR mapper, audit log, SMS screen | Built | Python, [FastAPI](https://fastapi.tiangolo.com/), [Authlib](https://docs.authlib.org/en/latest/oauth2/client/web/fastapi.html), [matrix-nio](https://github.com/matrix-nio/matrix-nio), [markdown-it-py](https://github.com/executablebooks/markdown-it-py), SQLite | 8000 |
| Simulated ID Austria | OpenID Connect login with fake citizens | Configured | [Keycloak](https://www.keycloak.org/server/containers) | 8080 |
| Mock eHVD | Directory of healthcare people and organisations | Built | `ehvd/directory.json` | none |
| Mailpit | Catches every outgoing email | Reused | [`axllent/mailpit`](https://hub.docker.com/r/axllent/mailpit) | 1025 SMTP, 8025 web |
| HAPI FHIR | FHIR R4 server | Reused | [`hapiproject/hapi`](https://hub.docker.com/r/hapiproject/hapi) | 8090, mapped to 8080 in the container |
| HL7 validator | Validates every filed resource | Reused | [`validator_cli.jar`](https://github.com/hapifhir/org.hl7.fhir.core/releases) | none |

The Matrix bot runs inside the request service process. One process means one database connection and no internal API between bot and portal.

Every reused part can be replaced. Synapse can be any Matrix homeserver, Keycloak can be real ID Austria or another OpenID Connect provider, Mailpit can be any SMTP server, and HAPI can be any FHIR R4 server.

```
 Dr. Hofer                                               Outside person
 Element Web                                             browser
     |                                                      |   |
     v                                                      |   | login
  Synapse <---- bot (matrix-nio) ----+                      |   v
                                     |                      |  Keycloak (simulated ID Austria)
                              Request service <-------------+   |
                               |   |   |   |   <-- signed token-+
                               |   |   |   +--> HAPI FHIR
                               |   |   +------> SQLite: requests, bindings, audit log
                               |   +----------> mock eHVD (JSON)
                               +--------------> Mailpit (email), /sms page (SMS)
```

## Document types

One table in the request service defines each document type. To add a type, add a row.

| Key | Bot keyword | Default channel | eHVD check | Mapper | Name in Matrix messages |
|---|---|---|---|---|---|
| `lab-result` | `lab-result` | email | Person is active, has the lab medicine specialty, and is a member of the named organisation | Lab mapper: Observations and DiagnosticReport | lab result |
| `rehab-report` | `rehab-report` | SMS | The named organisation exists and is active | Rehab mapper: DocumentReference | rehab discharge report |

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
| Dr. Hofer sends `!request` and the address check passes | none | `sent` |
| Dr. Hofer sends `!request` and the address check fails | none | `awaiting_confirmation` |
| Dr. Hofer sends `!send <id>` | `awaiting_confirmation` | `sent` |
| Identity check passes | `sent` | `verified` |
| Identity check matches the name partly | `sent` | `identity_held` |
| Identity check fails for the third time | `sent` | `locked` |
| Dr. Hofer sends `!accept <id>` | `identity_held` | `verified` |
| Answer passes the patient check and the role is confirmed | `verified` | `filed` |
| Answer passes the patient check and the role is not confirmed | `verified` | `answer_held` |
| Answer fails the patient check | `verified` | `verified` |
| Dr. Hofer sends `!accept <id>` | `answer_held` | `filed` |
| Dr. Hofer sends `!reject <id>` | `identity_held` or `answer_held` | `cancelled` |
| Dr. Hofer sends `!cancel <id>` | any open state | `cancelled` |
| 7 days pass | any open state | `expired` |

A failed identity check does not change the state, so the real person can still answer a forwarded link. The failure goes to the audit log and to Dr. Hofer.

## Link rules

- The link token is 32 random bytes, encoded URL-safe. The database stores only its SHA-256 hash.
- The link is valid for 7 days. It accepts one filed answer.
- Three failed identity checks lock the link. Dr. Hofer can send a new request.
- Until the identity check passes, the page shows only the requesting doctor and clinic.

## Matrix bot

The bot listens in rooms it has joined. It accepts commands only from Matrix users listed in `directory.json`, which holds `@lena.hofer:klinikum.example` for the demo.

| Command | Effect |
|---|---|
| `!request lab-result patient=maria-beispiel given=Eva family=Brandl email=eva.brandl@labor-kanal.example org="Labor Kanalstraße"` | Creates request 1 and sends the email |
| `!request rehab-report patient=maria-beispiel given=Stefan family=Kern phone="+43 660 000 0101" org="Reha Waldblick"` | Creates request 2 and sends the SMS |
| `!send <id>` | Sends a request despite the address warning |
| `!accept <id>` | Accepts a held identity or a held answer |
| `!reject <id>` | Rejects a held identity or a held answer |
| `!cancel <id>` | Cancels an open request |
| `!status <id>` | Shows the state and the audit entries of a request |

The bot parses commands with `shlex.split` and `str.partition("=")`. It rejects a request without `given`, `family`, `patient`, and either `email` or `phone`. Separate `given` and `family` fields avoid guessing which part of "Eva Maria Brandl" is the family name.

The bot answers in a thread under the request message:

- "Request 1 sent to Dr. Eva Brandl (Labor Kanalstraße) by email."
- "Warning. The address domain `labor-kanaI.example` does not match Labor Kanalstraße (`labor-kanal.example`). Send `!send 1` to send anyway or `!cancel 1`."
- "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address."
- "The answer to request 1 is about a different patient. Name and birth date do not match Maria Beispiel. Nothing was filed."
- "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range."

## Outgoing messages

The email and the SMS name the requesting doctor and clinic, the link, and the expiry date. Nothing else.

```
Subject: Secure request from Klinikum Beispielstadt

Hello,

Dr. Lena Hofer at Klinikum Beispielstadt has sent you a secure request.
Open it here: http://localhost:8000/r/<link token>

You need ID Austria to open it. The link expires on 5 November 2026.
If you did not expect this message, you can ignore it.
```

```
Klinikum Beispielstadt: Dr. L. Hofer sent you a secure request. Open it with ID Austria: http://localhost:8000/r/<link token> (valid until 5 Nov)
```

Before sending, the request service compares the words of the message with the patient's name words, the birth date in the formats `1961-03-12`, `12.03.1961`, and `12 March 1961`, and the document type words. It compares whole words, not substrings. A substring check would block every message, because the patient's family name "Beispiel" is part of "Klinikum Beispielstadt". [Compliance and safety](COMPLIANCE_AND_SAFETY.md) has the rule.

## Outside portal

| Route | What it does |
|---|---|
| `GET /r/{token}` | Writes `link_opened`. Shows the requesting doctor and clinic and a **Log in with ID Austria** button. |
| `GET /auth/login` | Redirects to Keycloak with `state` and `nonce`. |
| `GET /auth/callback` | Swaps the code for tokens, verifies the ID token, runs the identity checks, and writes `identity_checked`. |
| `GET /r/{token}/answer` | Shows the patient, the requested document, the upload field, and fields for the patient's name and birth date. Only after the identity check passes. |
| `POST /r/{token}/answer` | Writes `answer_sent`, parses the document, runs the patient check, files the resources, and writes `answer_filed`. |
| `GET /sms` | Shows every SMS the request service would have sent, like a phone screen. |
| `GET /audit` | Shows the audit log for the demo. Bound to localhost. |

A signed session cookie holds the request id and, after login, the person number. It expires after 30 minutes.

## Document parsing

The scenario documents share one Markdown format:

- a heading `# <Organisation>: <document kind>`, for example `# Labor Kanalstraße: lab report`
- `Key: value` lines such as `Patient`, `Sample taken`, `Reported`, `Stay`, `Validated by`, `Written by`, and `Sent by`
- for lab results, a table with the columns `Test`, `Result`, `Unit`, `Reference range`, and `LOINC code`
- free text sections such as `## Course` and `## Recommendations`

The parser reads headings and tables from markdown-it-py tokens and splits `Key: value` lines with `str.partition(": ")`. It reads dates with `datetime.strptime` in the `Europe/Vienna` time zone, for example `"%d %B %Y, %H:%M"` for `22 October 2026, 08:10`. The `Patient` line splits at `", born "` into name and birth date.

The document kind picks the mapper. `lab report` goes to the lab mapper and `discharge report` goes to the rehab mapper. Any other kind becomes a DocumentReference with the text attached, held for Dr. Hofer.

### AI fallback (optional, cut first)

If the parser cannot read a document, a language model may extract the same fields as JSON against a fixed schema. Every value and every LOINC code it returns must appear word for word in the document. The patient check stays deterministic. An answer read by the model always waits for Dr. Hofer's `!accept`.

## Storage

The request service keeps three SQLite tables.

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

Every entry has a UTC timestamp in `at`. `!status <id>` in Matrix and `GET /audit` show the entries.

## Configuration

| Variable | Example |
|---|---|
| `PUBLIC_BASE_URL` | `http://localhost:8000` |
| `MATRIX_HOMESERVER` | `http://localhost:8008` |
| `MATRIX_BOT_USER` | `@requestbot:klinikum.example` |
| `MATRIX_BOT_PASSWORD` | in `.env` only |
| `OIDC_METADATA_URL` | `http://localhost:8080/realms/idaustria-sim/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` | `request-service` |
| `OIDC_CLIENT_SECRET` | in `.env` only |
| `FHIR_BASE` | `http://localhost:8090/fhir` |
| `SMTP_HOST`, `SMTP_PORT` | `localhost`, `1025` |
| `SESSION_SECRET` | in `.env` only |

To switch to real ID Austria, change `OIDC_METADATA_URL`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`, and map the claim names in one place. [Identity and misdelivery](IDENTITY.md) lists the claims.

## Repository layout (planned)

```
docker-compose.yml
.env.example
keycloak/realm-idaustria-sim.json
ehvd/directory.json
synapse/                      generated homeserver.yaml
element/config.json
service/
	app.py                    FastAPI routes and session
	bot.py                    Matrix commands and notices
	doctypes.py               the document types table
	identity.py               name match, eHVD check, bindings
	parser.py                 Markdown to typed records
	fhir_mapper.py            typed records to FHIR JSON
	audit.py
	messages.py               email and SMS templates and the content check
scripts/
	validate.sh               HL7 validator on every filed resource
	audit_check.py            six event types per request
track/                        track brief, scenario, patient.json, and test documents
```

## Run it (planned)

1. Copy `.env.example` to `.env` and fill in the secrets.
2. Generate the Synapse config once:
	`docker run --rm -v ./synapse:/data -e SYNAPSE_SERVER_NAME=klinikum.example -e SYNAPSE_REPORT_STATS=no matrixdotorg/synapse generate`
3. Start everything with `docker compose up -d`.
4. Create the Matrix users `@lena.hofer` and `@requestbot` with `register_new_matrix_user` inside the Synapse container.
5. Open Element at `http://localhost:8081`, log in as Dr. Hofer, create a room, and invite the bot.
6. Send the request commands from the Matrix bot section.
7. Open Mailpit at `http://localhost:8025` or the SMS screen at `http://localhost:8000/sms` and follow the link.

## Sources

- [Synapse](https://github.com/element-hq/synapse) and [Element Web](https://github.com/element-hq/element-web)
- [Keycloak: importing and exporting realms](https://www.keycloak.org/server/importExport) and [server administration guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
- [Authlib: FastAPI OAuth client](https://docs.authlib.org/en/latest/oauth2/client/web/fastapi.html)
- [Mailpit](https://mailpit.axllent.org/)
- [HAPI FHIR JPA server starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
