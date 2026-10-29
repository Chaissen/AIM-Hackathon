# Timeline

Track 2, health data interoperability. The event window is assumed to run from Thursday 16:00 to Friday 19:00, local time. If the official agenda differs, move the times and keep the order.

## Roles

| Short name | Focus in Track 2 |
|---|---|
| **Dev 1** | Docker setup, Keycloak realm, request service, outside portal, email and SMS |
| **Dev 2** | FHIR mapping, transactions, Provenance, Task, validation, metric scripts |
| **Dev 3** | Matrix bot, document parser, identity checks, patient check, mock eHVD, optional AI fallback |
| **Doc 1** | Identity policy per document type, test documents, misdelivery runs, clinical review of the FHIR content |
| **Doc 2** | Demo script, timed test with someone new, video, README design answers |

[Roles and workflow](ROLES_AND_WORKFLOW.md) has the full ownership table.

## Milestones

Each milestone may slip 30 minutes. A longer slip triggers the cut list.

| Time | Milestone | Done when | Checked by |
|---|---|---|---|
| Thu 18:00 | 1. Scope lock | The docs in `organisations/` describe Track 2 and the team agrees on them | Doc 1 |
| Thu 21:30 | 2. Infrastructure up | `docker compose up` starts Synapse, Element, Keycloak with the imported realm, Mailpit, and HAPI. Dr. Hofer logs in to Element. `eva.brandl` logs in to Keycloak. | Dev 1 |
| Thu 24:00 | 3. Happy path | Request 1 runs end to end. The bot command sends an email, Dr. Brandl logs in and uploads, four Observations, a DiagnosticReport, and a Provenance land in HAPI, and Dr. Hofer gets the Matrix message. | Dev 1, Dev 2, Dev 3 |
| Fri 09:30 | 4. Misdelivery and audit | M1, M2, and M3 are caught. A request shows 6 of 6 audit event types. Request 2 runs through the SMS screen. | Doc 1 |
| Fri 12:30 | 5. Feature freeze | The validator reports 0 errors on every filed resource. Someone new answers request 1 in under 2 minutes. The README has the design answers. | Dev 1 |
| Fri 13:30 | 6. Video | A video of up to 2 minutes, recorded on the frozen build, says what works and what does not | Doc 2 |
| Fri 15:00 | 7. Submission | Public repository with run instructions, architecture, design answers, and metric results. The submission form is sent. | Dev 1 |
| Fri 17:30 | Pitch | Live demo, with the video as backup | Doc 2, Doc 1 |

## Tasks

The task ids go into branch names and commit messages.

| Id | Task | Owner | Needs | Milestone |
|---|---|---|---|---|
| T01 | Repository, `docker-compose.yml`, `.env.example` | Dev 1 | none | 2 |
| T02 | Keycloak realm: client, user profile, mappers, test citizens, sign-up, simulation label | Dev 1 | T01 | 2 |
| T03 | Synapse config, Matrix users, Element config | Dev 3 | T01 | 2 |
| T04 | Request service skeleton: SQLite tables, request states, audit log | Dev 1 | T01 | 3 |
| T05 | Matrix bot: `!request`, notices, `!status` | Dev 3 | T03, T04 | 3 |
| T06 | Email to Mailpit, SMS screen, outgoing message check | Dev 1 | T04 | 3 |
| T07 | Login with Authlib, ID token check, session | Dev 1 | T02, T04 | 3 |
| T08 | Identity checks: level, name match, person number binding | Dev 3 | T07 | 3 |
| T09 | Answer form and upload | Dev 1 | T07 | 3 |
| T10 | Parser for lab results and rehab reports | Dev 3 | none | 3 |
| T11 | Patient check on document and form | Dev 3 | T10 | 3 |
| T12 | Lab mapper: Observations and DiagnosticReport | Dev 2 | T10 | 3 |
| T13 | Provenance, Task, Practitioner, Organization, transaction Bundle | Dev 2 | T12 | 3 |
| T14 | Rehab mapper: DocumentReference | Dev 2 | T10, T13 | 4 |
| T15 | Mock eHVD, role check, address check before sending | Dev 3, data by Doc 1 | T05 | 4 |
| T16 | Test documents: new outside people, wrong patients, odd names | Doc 1 | none | 4 |
| T17 | Misdelivery runs M1, M2, M3 and the audit check | Doc 1, Dev 2 | T08, T11, T15 | 4 |
| T18 | `scripts/validate.sh` and 0 validator errors | Dev 2 | T13, T14 | 5 |
| T19 | Timed test with someone new | Doc 2 | T09 | 5 |
| T20 | README: run instructions, architecture, design answers, metric results | Doc 2, Dev 1 | T17, T18, T19 | 5 |
| T21 | Demo script and video | Doc 2 | Milestone 5 | 6 |
| T22 | AI fallback parser (optional) | Dev 3 | T10 | none |

The critical path runs T01, T02, T07, T08, T09, T13, T18, T21. When two tasks compete for one person, the task on the critical path wins.

## Workstreams

| Window | Dev 1 | Dev 2 | Dev 3 | Doc 1 | Doc 2 |
|---|---|---|---|---|---|
| Thu 18:00 to 21:30 | T01, T02 | FHIR examples by hand, validator set up, T12 started on a sample record | T03, T10 | Identity policy, eHVD data | Demo story, README skeleton |
| Thu 21:30 to 24:00 | T04, T06, T07 | T12, T13 | T05, T08, T11 | T16 | Script for the timed test |
| Fri 07:30 to 09:30 | T09, fixes | T14 | T15 | T17 | Video storyboard |
| Fri 09:30 to 12:30 | Polish, Keycloak label | T18 | Fixes, T22 if time | Clinical review of the filed FHIR data | T19, T20 |
| Fri 12:30 to 15:00 | T20, submission | Metric results | Freeze prompts if T22 exists | Q&A answers | T21 |

## Cut list

Cut in this order when a milestone slips more than 30 minutes:

1. T22, the AI fallback parser.
2. MedicationStatements from the rehab report. They are already only a stretch goal.
3. The Keycloak login theme. Keep the "simulation" text.
4. The Task resource. Keep the request state in SQLite.
5. The eHVD role check and the address check. Keep the name match and the person number.

Never cut the identity check before the patient is shown, the patient check, the six audit events, the message content rule, 0 validator errors, or the video.

## Sync rhythm

- Stand-ups at Thu 18:00, Thu 21:30, Fri 07:30, Fri 11:00, and Fri 12:30. Ten minutes at most, blockers only.
- One team chat. Start blockers with `BLOCKED:` and decisions with `DECISION:`.
- Everyone sleeps at least five hours. Nobody works alone after 02:00.
