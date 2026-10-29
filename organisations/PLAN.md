# Plan

Scope and design are in [WHITEPAPER.md](WHITEPAPER.md). Claude writes the code. The team decides, reviews, tests, and builds the pitch.
⚠ Check the times marked * against the official agenda.

## Milestones

| When | Milestone | Done when |
|---|---|---|
| Thu 18:00 | **Scope Lock** | Decisions D1–D5 in the whitepaper are filled in |
| Thu 20:00 | **Core Schema** | Docker stack runs; FHIR model agreed and the example resources validate with 0 errors |
| Thu 23:00 | **API MVP** | Request 1 works end to end: bot → email → eID → upload → FHIR filed → Matrix message |
| Fri 09:30 | **Guardrails** | M1–M3 caught 3/3, audit 6/6, request 2 (SMS) works |
| Fri 12:30 | **Feature Freeze** | Only fixes and docs after this |
| Fri 13:30 | **Video** | ≤ 2 min video recorded and uploaded, stating what works and what does not |
| Fri 15:00* | **Submission** | Public repo, README with design answers and architecture, metric results |
| Fri 17:00–19:00* | Pitch and closing | |

## Build order (Claude implements; the reviewer checks and merges)

| # | Task | Reviewer | Needs |
|---|---|---|---|
| 1 | `docker-compose`: Synapse, Element, HAPI, Mailpit and the service; seed `@lena.hofer` and the bot | Dev 1 | – |
| 2 | Service skeleton, audit log (`AuditEvent` + local file), config | Dev 1 | 1 |
| 3 | FHIR builders: Patient load, lab → DiagnosticReport + Observations, rehab → DocumentReference, Provenance, Task; validator script | Dev 2 | 2 |
| 4 | Bot `!request` command → Task + one-time link → email or SMS page, with no patient data in the message | Dev 1 | 2 |
| 5 | Portal: open link → simulated ID Austria → name match → answer page (upload + patient fields) | Dev 3 | 4 |
| 6 | Patient match, filing as a transaction Bundle, Matrix notice (success and warnings) | Dev 2 | 3, 5 |
| 7 | Automated test run: request 1, request 2, M1–M3, audit count, validator → `metrics.md` | Dev 2 | 6 |
| 8 | README: how to run, architecture, the 5 design answers, metric results | Doc 1 + Dev 1 | 7 |
| 9 | Stretch: lookalike-domain warning, AI medication extraction (D3), Element widget | Dev 3 | 7 |

## Who does what

| Person | Responsibility |
|---|---|
| **Dev 1** (SE) | Runs the stack locally, owns the demo machine, reviews infra, bot and service code |
| **Dev 2** (DS) | Owns FHIR correctness (LOINC, UCUM, references), runs the validator, owns the metric results |
| **Dev 3** (AI) | Owns the identity flow and misdelivery logic, decides whether to use AI, writes extra adversarial test documents |
| **Doc 1** (Clinical) | Decides D1, D2, D4; checks "would a lab or rehab clinic really answer this way?"; writes new test documents in the scenario format (other senders, wrong patients) as the jury will |
| **Doc 2** (Pitch) | Pitch, video, demo script. Stay away from the answer flow until the effort test (or recruit an outsider): you are our "someone new" for the < 2 min metric |

## Working rules

- `main` must always run. Work happens on feature branches `feat/<n>-<name>` (n = build-order number). Every PR needs one human review and gets merged the same hour.
- Only synthetic data goes into the repo. No secrets: use `.env`, with `.env.example` committed.
- Raise blockers in chat with `BLOCKED:` and decisions with `DECISION:`, and copy each decision into the whitepaper table.
- If we fall behind, cut in this order: the widget → AI → the SMS polish. Never cut: identity check, patient match, audit, validator 0 errors, video.
