# TIMELINE - AIM Clinical AI Hackathon 2026

> **Assumptions.** Track: *Clinical Documentation* with FHIR R4 structured output (adjust in WHITEPAPER.md if the team changes track). Event window: **Thursday 16:00 to Friday 19:00** (27 hours). Times below are local. If the organisers' agenda differs, shift the "Official agenda" column only; milestone offsets stay the same.

## Roles (short names used throughout)

| Short name | Person | Focus |
|---|---|---|
| **Dev 1** | Software Engineer | API, frontend/demo UI, CI, deployment |
| **Dev 2** | Data Scientist | Data pipeline, synthetic data, FHIR/DB schema, vector/graph store, evaluation |
| **Dev 3** | AI/LLM Engineer | Prompting, extraction, guardrails, model orchestration |
| **Doc 1** | Clinical Product Owner | Clinical scope, test cases, safety review, acceptance |
| **Doc 2** | Pitch Lead | Narrative, slides, demo script, video, Q&A prep |

## 1. Master Schedule vs. Official Agenda

| Time | Official agenda (assumed) | Team activity | Owner |
|---|---|---|---|
| **Thu 16:00** | Opening and kickoff | Attend kickoff; capture track rules, judging criteria, submission format | All |
| Thu 16:30 | Track briefing / team formation closes | Confirm track; Doc 1 drafts problem statement; Dev 1 creates repo, CI skeleton | Doc 1, Dev 1 |
| Thu 17:00 | Hacking starts | Scope workshop (60 min): user, workflow, in/out of scope, success metric | Doc 1 (lead), all |
| **Thu 18:00** | - | **MILESTONE 1: SCOPE LOCK** (one-page scope signed off in `WHITEPAPER.md`) | Doc 1 |
| Thu 18:00-19:30 | Mentor office hours | Dev 2 builds synthetic data generator; Dev 3 first prompt prototype; Dev 1 API skeleton; Doc 2 pitch outline | Per stream |
| Thu 19:30 | Dinner | Break; informal sync (15 min) | All |
| Thu 20:30-21:30 | - | Schema review session: FHIR resources, JSON output contract | Dev 2, Dev 3, Doc 1 |
| **Thu 21:30** | - | **MILESTONE 2: CORE SCHEMA** (FHIR profile subset + JSON Schema frozen at v1) | Dev 2 |
| Thu 21:30-24:00 | Evening hacking | Integration of extraction -> schema validation -> storage; Doc 1 delivers first 10 synthetic cases | Dev 2, Dev 3, Doc 1 |
| **Thu 24:00** | - | **MILESTONE 3: API MVP** (`POST /encounters/structure` returns schema-valid FHIR Bundle on 3 cases) | Dev 1 |
| Fri 00:00-07:00 | Venue overnight (assumed) | Rest in shifts. One person on-call 00:00-02:00 for CI breaks (Dev 1), no new features | Dev 1 |
| Fri 07:30 | Breakfast | Stand-up (15 min): status, blockers, today's cut list | All |
| Fri 08:00-09:30 | - | Guardrail implementation and red-team case run | Dev 3, Doc 1 |
| **Fri 09:30** | - | **MILESTONE 4: CLINICAL GUARDRAILS** (dose/lab checks, schema enforcement, fallback; Doc 1 sign-off on safety cases) | Dev 3, Doc 1 |
| Fri 09:30-12:30 | Mentor check-ins / judging slots open | Feature completion, UI polish, evaluation numbers, slide build | All |
| **Fri 12:30** | - | **MILESTONE 5: FEATURE FREEZE.** Only bug fixes and docs after this. | Dev 1 enforces |
| Fri 12:30-13:30 | Lunch | Record demo video (rehearsed take) on frozen build | Doc 2, Dev 1 |
| **Fri 13:30** | - | **MILESTONE 6: DEMO VIDEO BACKUP** uploaded and link tested on a second device | Doc 2 |
| Fri 13:30-15:00 | Submission window | README, architecture diagram, license, final regression, tag release | Dev 1, Dev 2, Dev 3 |
| **Fri 15:00** | Code submission deadline (assumed) | **MILESTONE 7: CODE SUBMISSION** (tag `v1.0-submission`, form submitted, link verified) | Dev 1 |
| Fri 15:00-17:30 | Pitch preparation | Pitch rehearsals x3 with timer; Q&A drill | Doc 2, Doc 1 |
| Fri 17:30-18:30 | Final pitches / judging | Live pitch and demo; video as fallback | Doc 2, Doc 1 |
| **Fri 19:00** | Awards and closing | Close | All |

Buffer rule: every milestone has a 30-minute slip allowance. A slip over 30 minutes triggers the cut list in section 5.

## 2. Milestone Checkpoints and Exit Criteria

| # | Milestone | Deadline | Exit criteria (all must be true) | Verifier |
|---|---|---|---|---|
| 1 | **Scope Lock** | Thu 18:00 | One target user and one workflow named; 3 in-scope outputs; explicit out-of-scope list; one measurable success metric (e.g. documentation time per encounter); scope text merged into `WHITEPAPER.md` | Doc 1 |
| 2 | **Core Schema** | Thu 21:30 | FHIR resource subset listed (e.g. Patient (synthetic), Encounter, Condition, MedicationStatement, Observation); JSON Schema file `schemas/clinical_note.schema.json` committed; example valid and invalid payloads; DB tables/collections created | Dev 2 |
| 3 | **API MVP** | Thu 24:00 | `POST /encounters/structure` accepts free text, returns schema-valid output on 3 synthetic cases; `GET /health`; Docker or single-command local run; CI green | Dev 1 |
| 4 | **Clinical Guardrails** | Fri 09:30 | Schema enforcement on model output; dosage and lab range checks active; fallback returns "needs clinician review" rather than guessing; 10 adversarial cases run and logged; Doc 1 sign-off recorded in `docs/safety_signoff.md` | Dev 3, Doc 1 |
| 5 | **Feature Freeze** | Fri 12:30 | Release branch cut from `main`; no feature PRs merged after this time; open issues triaged to "fix" or "won't do" | Dev 1 |
| 6 | **Demo Video Backup** | Fri 13:30 | 2-3 minute video recorded on frozen build; uploaded to two places; plays from a second device; captions or on-screen text for key claims | Doc 2 |
| 7 | **Code Submission** | Fri 15:00 | README with run instructions; architecture diagram; license; disclaimer; submission form complete; repo access verified from a logged-out browser | Dev 1 |

## 3. Task Dependency Matrix

Rows are tasks; "Blocked by" lists what must finish first. IDs are used in issues and PR titles.

| ID | Task | Owner | Blocked by | Blocks |
|---|---|---|---|---|
| T01 | Create repo, branch protection, CI skeleton | Dev 1 | none | T07, T09 |
| T02 | Problem statement and target user | Doc 1 | none | T03 |
| T03 | Scope lock document | Doc 1 | T02 | T04, T05, T06 |
| T04 | FHIR resource subset and JSON Schema v1 | Dev 2 | T03 | T07, T08, T10, T12 |
| T05 | Synthetic case set v1 (10 cases, free text plus gold answers) | Doc 1 | T03 | T08, T11, T13 |
| T06 | Pitch outline and storyline | Doc 2 | T03 | T17 |
| T07 | API skeleton and endpoint contract | Dev 1 | T01, T04 | T09, T14 |
| T08 | Extraction prompt v1 and structured output call | Dev 3 | T04, T05 | T09, T12 |
| T09 | End-to-end flow: text -> LLM -> validation -> storage (API MVP) | Dev 1 + Dev 3 | T07, T08 | T13, T14 |
| T10 | DB setup: relational plus vector/graph store | Dev 2 | T04 | T11, T15 |
| T11 | Terminology and reference data loader (units, drug ranges, lab ranges) | Dev 2 | T10, T05 | T12 |
| T12 | Guardrail layer: schema enforcement, dose/lab checks, fallback | Dev 3 | T04, T08, T11 | T13, T16 |
| T13 | Evaluation harness (field accuracy, hallucination rate, schema-valid rate) | Dev 2 | T05, T09 | T16, T17 |
| T14 | Demo UI (input pane, structured output pane, flags) | Dev 1 | T07, T09 | T16, T17 |
| T15 | Retrieval/graph feature (e.g. guideline lookup, drug-interaction hints) | Dev 2 + Dev 3 | T10 | T16 |
| T16 | Clinical safety review and sign-off | Doc 1 | T12, T13, T14 | Feature Freeze |
| T17 | Slides, demo script, video | Doc 2 | T06, T13, T14 | Video Backup |
| T18 | README, architecture diagram, license, tag release | Dev 1 + Dev 2 | Feature Freeze | Code Submission |
| T19 | Pitch rehearsals and Q&A prep | Doc 2 + Doc 1 | T17 | Final pitch |

Critical path: **T02 -> T03 -> T04 -> T08 -> T09 -> T12 -> T16 -> Feature Freeze -> T17 (video) -> T18 -> Code Submission.** Anything on this path gets priority when two tasks compete for the same person.

## 4. Parallel Workstreams

### Dev 1 - Software Engineering / API

| Window | Work | Output |
|---|---|---|
| Thu 16:30-18:00 | Repo, branch protection, CI (lint, tests), PR template, docker-compose | Working skeleton on `main` |
| Thu 18:00-21:30 | FastAPI (or equivalent) app, endpoint contract, mock responses so others can integrate | OpenAPI doc at `/docs` |
| Thu 21:30-24:00 | Wire model call, validation, storage into API (with Dev 3) | **API MVP** |
| Fri 08:00-12:30 | Demo UI, error handling, logging without PHI, performance check | Demo-ready UI |
| Fri 12:30-15:00 | Release branch, README, deployment/run script, submission | **Code Submission** |

### Dev 2 - Data Science / Database

| Window | Work | Output |
|---|---|---|
| Thu 16:30-18:00 | Choose FHIR subset with Doc 1; research available public synthetic datasets (e.g. Synthea-style output) | Resource list |
| Thu 18:00-21:30 | JSON Schema v1, FHIR mappings, synthetic data generator, DB schema | **Core Schema** |
| Thu 21:30-24:00 | Load reference ranges (labs, drug dose limits) and vector/graph index | Reference data tables |
| Fri 08:00-12:30 | Evaluation harness, metrics, error analysis, retrieval tuning | Results table for pitch |
| Fri 12:30-15:00 | Data documentation, reproducibility script, architecture diagram | Docs in repo |

### Dev 3 - AI / LLM Engineering

| Window | Work | Output |
|---|---|---|
| Thu 16:30-18:00 | Model access check, latency/cost test, pick model(s) | Model decision note |
| Thu 18:00-21:30 | Extraction prompt v1 using structured output / tool-calling against the JSON Schema | Prompt v1 and first outputs |
| Thu 21:30-24:00 | Retry and repair loop; integration with API (with Dev 1) | Stable call path |
| Fri 08:00-09:30 | Guardrails: dose/lab validation, unit normalisation, source-span grounding, fallback | **Clinical Guardrails** |
| Fri 09:30-12:30 | Prompt iteration against evaluation harness; adversarial cases | Final prompt version |
| Fri 12:30-15:00 | Freeze prompts and model versions; document limitations | Docs in repo |

### Doc 1 - Clinical Product Owner

| Window | Work | Output |
|---|---|---|
| Thu 16:30-18:00 | Problem statement, user definition, workflow map | **Scope Lock** |
| Thu 18:00-21:30 | Write 10 synthetic cases with gold-standard answers (see handoff protocol in ROLES_AND_WORKFLOW.md) | Case set v1 |
| Thu 21:30-24:00 | Review schema for clinical validity; write 10 more cases including edge cases | Case set v2 |
| Fri 08:00-09:30 | Red-team cases: ambiguous doses, unit traps, negations, conflicting statements | Adversarial set |
| Fri 09:30-12:30 | Review outputs, grade results, safety sign-off | `docs/safety_signoff.md` |
| Fri 12:30-17:30 | Clinical Q&A prep with Doc 2; co-present | Q&A sheet |

### Doc 2 - Pitch Lead

| Window | Work | Output |
|---|---|---|
| Thu 17:00-21:30 | Read judging criteria; pitch storyline (problem -> solution -> proof -> impact); gather 2-3 cited statistics on documentation burden | Pitch outline |
| Thu 21:30-24:00 | Draft slides (max 8) with placeholders for live metrics | Deck v0 |
| Fri 08:00-12:30 | Fill metrics from Dev 2; write demo script; storyboard video | Deck v1, demo script |
| Fri 12:30-13:30 | Record demo video with Dev 1 operating UI | **Demo Video Backup** |
| Fri 13:30-17:30 | Three timed rehearsals; Q&A drill with team; tech check at the stage | Final deck |
| Fri 17:30-18:30 | Deliver pitch | Pitch |

## 5. Cut List (apply in this order when behind schedule)

1. Drop the graph/vector retrieval feature (T15); keep static reference tables.
2. Reduce supported resource types to Condition, MedicationStatement, Observation.
3. Replace live UI polish with a clean CLI/notebook demo and rely on the video.
4. Reduce evaluation set from 20 to 10 cases, but report the number honestly.
5. Never cut: schema enforcement, dose/lab checks, fallback, disclaimer, demo video backup.

## 6. Sync Rhythm

- **Stand-ups:** Thu 18:00 (scope lock), Thu 21:30 (schema), Fri 07:30, Fri 11:00, Fri 12:30 (freeze). Max 10 minutes each, standing, blockers only.
- **Async channel:** one team chat; blockers prefixed `BLOCKED:`; decisions prefixed `DECISION:`.
- **Rest:** at least 5 hours of sleep per person; nobody works alone past 02:00.
