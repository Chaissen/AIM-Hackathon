#!/usr/bin/env bash
# init_org.sh - run from the repository root to create and populate organisations/
set -euo pipefail

mkdir -p organisations

# ---------------------------------------------------------------------------
# TIMELINE.md
# ---------------------------------------------------------------------------
cat > organisations/TIMELINE.md <<'TIMELINE_EOF'
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
TIMELINE_EOF

# ---------------------------------------------------------------------------
# WHITEPAPER.md
# ---------------------------------------------------------------------------
cat > organisations/WHITEPAPER.md <<'WHITEPAPER_EOF'
# WHITEPAPER - Structured Clinical Documentation Assistant

**Working title:** *ClinNote-to-FHIR* (rename before submission)
**Track:** Clinical Documentation (with FHIR R4 interoperable output)
**Status:** Hackathon prototype using synthetic data only. Not a medical device.

> Team note: figures marked **[measure]** are filled in with our own evaluation results before the pitch. Figures marked **[cited]** come from published literature and must carry a reference on the slide. Do not present an unmeasured number as a result.

## 1. Executive Summary

Clinicians spend a large share of their working day on documentation instead of on patients. Free-text notes are quick to write but hard to reuse: they cannot be searched reliably, they do not flow into other systems, and they invite transcription errors when copied into structured fields, referrals, or discharge letters.

We built an AI-assisted workflow that takes an unstructured clinical encounter note (or dictation transcript), extracts the clinically relevant facts, validates them against a strict JSON Schema, maps them to **HL7 FHIR R4** resources, and runs clinical guardrails (dose and laboratory plausibility, unit checks, grounding to source text) before anything is shown to the clinician. Every extracted item points back to the sentence it came from. Anything the system cannot ground or validate is flagged for human review instead of being guessed.

The result is a clinician-reviewable structured draft that can be exchanged between systems, in line with the European move toward interoperable health records under the European Health Data Space (EHDS).

## 2. Clinical Problem Statement

### 2.1 Unmet medical need

- **Documentation burden.** Physicians report spending a substantial proportion of their working time on documentation and administrative tasks, with a significant part of it outside working hours **[cited]**. This contributes to burnout and reduces direct patient contact time.
- **Unstructured data is hard to reuse.** Clinically important facts (medications, doses, allergies, problems, lab values) sit inside prose. Re-entering them into structured fields is manual, slow, and error-prone.
- **Medication and lab transcription errors.** Wrong unit, decimal slip (e.g. 0.5 mg vs 5 mg), or a value attached to the wrong analyte can propagate into later documents and decisions **[cited]**.
- **Interoperability gap.** Hospitals, GPs, and cross-border services often cannot exchange notes in machine-readable form, which conflicts with the goals of the EHDS regulation for primary use of health data across Member States.

### 2.2 Target users

| User | Need | How the tool helps |
|---|---|---|
| **Hospital physician / resident** | Finish the note and discharge letter faster | Pre-structured draft from the free-text note; one-click review |
| **General practitioner** | Keep a clean problem and medication list | Extracted problems, medications, observations ready for the record |
| **Clinical coder / documentation specialist** | Find codeable facts in prose | Source-linked extracted entities |
| **Receiving clinician (referral, cross-border)** | Understand the patient quickly | Standard FHIR Bundle plus short human-readable summary |

**Primary persona for the demo (confirm at Scope Lock):** a hospital resident writing a post-consultation note for an internal-medicine patient with several chronic conditions and a multi-drug regimen.

### 2.3 Scope for the hackathon

In scope: free-text English encounter notes (synthetic); extraction of problems, medications (name, dose, unit, frequency, route), allergies, vital signs and lab results; FHIR Bundle output; guardrails; clinician review UI.
Out of scope: diagnosis or treatment recommendations; real patient data; integration with a live EHR; speech-to-text; non-English input; regulatory certification.

## 3. Solution Overview

### 3.1 AI workflow

```
 Clinician note (synthetic text)
            |
            v
 [1] Pre-processing: de-identification check, sentence segmentation, section detection
            |
            v
 [2] LLM extraction with schema-constrained output (JSON Schema)
            |
            v
 [3] Validation layer: schema check -> unit normalisation -> dose/lab range checks
            |                              |
            |                              +--> fails: repair loop (max 2 tries) -> fallback "needs review"
            v
 [4] Grounding check: every field must cite a source span in the note
            |
            v
 [5] FHIR mapper: JSON -> FHIR R4 Bundle (Condition, MedicationStatement, Observation, AllergyIntolerance)
            |
            v
 [6] Storage + retrieval (relational + vector/graph) -> clinician review UI with flags
            |
            v
 Clinician accepts / edits / rejects -> final structured record (export as FHIR JSON)
```

### 3.2 Integration points

- **Input:** REST endpoint `POST /encounters/structure` (text in). Production path: EHR note-saved event or dictation system output.
- **Output:** FHIR R4 Bundle (JSON) via REST; compatible with a FHIR server `POST [base]/Bundle` transaction.
- **Terminology:** SNOMED CT, LOINC, and ATC/RxNorm mappings are loaded as reference tables for the prototype (a small subset is bundled; production would use a terminology server).
- **Human in the loop:** nothing is written to a record without clinician acceptance.

### 3.3 Expected clinical outcomes

| Outcome | Expected effect | Evidence plan |
|---|---|---|
| Documentation time per encounter | Reduced by a measurable fraction | **[measure]** timed comparison on synthetic cases: manual structuring vs review-and-accept |
| Structured-data completeness | Higher share of notes with complete medication and problem lists | **[measure]** field recall vs gold answers |
| Transcription errors reaching the record | Fewer, because implausible doses or units are flagged | **[measure]** seeded-error detection rate |
| Interoperability | Notes exportable in standard form | Validate Bundle against FHIR profile validator |

## 4. Technical and Data Architecture

### 4.1 Component view

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Lightweight web UI (React or Streamlit) | Fast to build; side-by-side note vs structured output with source highlighting |
| API | FastAPI (Python) | Typed models, auto OpenAPI docs, easy JSON Schema/Pydantic reuse |
| LLM orchestration | Thin custom layer (no heavy framework) | Fewer moving parts; full control of retries and validation |
| Validation | Pydantic + `jsonschema` | Same schema enforced at API boundary and on model output |
| FHIR | `fhir.resources` (Pydantic FHIR models) | Programmatic FHIR R4 validation |
| Relational store | SQLite or PostgreSQL | Encounters, extracted facts, review decisions, audit log |
| Vector store | pgvector or Chroma | Retrieval of guideline snippets and terminology lookup |
| Graph store (optional) | Neo4j or in-memory NetworkX | Drug-interaction and condition-medication relationships |
| CI | GitHub Actions | Lint, tests, schema validation on every PR |

### 4.2 Model selection

Selection criteria: (1) reliable structured output / tool-calling against a JSON Schema, (2) accuracy on medical extraction, (3) latency under about 5 seconds per note, (4) data-handling terms suitable for a synthetic-data demo, (5) cost within hackathon credits.

| Role | Candidate | Use |
|---|---|---|
| Primary extractor | A current frontier Claude model (e.g. Sonnet-class) via API with structured output | Main extraction, reasoning about negation and context |
| Fast checker | A small, fast model (e.g. Haiku-class) | Second-opinion grounding check and unit-conversion sanity pass |
| Embeddings | A general-purpose embedding model | Retrieval of reference snippets |
| Deterministic layer | Plain Python | Dose and lab checks are **rules, not model opinions** |

Dev 3 records the final choice, version string, and temperature (0 for extraction) in `docs/model_card.md` at Feature Freeze. Self-hosted open models are a documented alternative for production to keep data inside the hospital or EU region.

### 4.3 Data and schema design

**Principle:** the LLM fills a constrained JSON structure; deterministic code validates it; a mapper converts it to FHIR. The model never emits raw FHIR directly, which keeps outputs small, checkable, and testable.

Intermediate JSON contract (abridged, `schemas/clinical_note.schema.json`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["encounter", "problems", "medications", "observations", "allergies", "review_flags"],
  "properties": {
    "encounter": {
      "type": "object",
      "required": ["note_id", "setting"],
      "properties": {
        "note_id": {"type": "string"},
        "setting": {"enum": ["inpatient", "outpatient", "emergency", "primary_care"]}
      }
    },
    "problems": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["text", "status", "source_span"],
        "properties": {
          "text": {"type": "string"},
          "status": {"enum": ["active", "resolved", "suspected", "negated"]},
          "snomed_code": {"type": ["string", "null"]},
          "source_span": {"type": "string"}
        }
      }
    },
    "medications": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "dose_value", "dose_unit", "frequency", "source_span"],
        "properties": {
          "name": {"type": "string"},
          "dose_value": {"type": ["number", "null"]},
          "dose_unit": {"enum": ["mg", "g", "mcg", "mL", "IU", "unit", null]},
          "frequency": {"type": ["string", "null"]},
          "route": {"enum": ["oral", "iv", "im", "sc", "topical", "inhaled", null]},
          "atc_code": {"type": ["string", "null"]},
          "source_span": {"type": "string"}
        }
      }
    },
    "observations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "value", "unit", "source_span"],
        "properties": {
          "name": {"type": "string"},
          "loinc_code": {"type": ["string", "null"]},
          "value": {"type": ["number", "null"]},
          "unit": {"type": ["string", "null"]},
          "source_span": {"type": "string"}
        }
      }
    },
    "allergies": {"type": "array", "items": {"type": "object"}},
    "review_flags": {"type": "array", "items": {"type": "string"}}
  },
  "additionalProperties": false
}
```

**FHIR mapping**

| JSON section | FHIR R4 resource |
|---|---|
| `problems` | `Condition` (clinicalStatus, verificationStatus, code) |
| `medications` | `MedicationStatement` (medicationCodeableConcept, dosage.doseAndRate, timing, route) |
| `observations` | `Observation` (code LOINC, valueQuantity with UCUM units) |
| `allergies` | `AllergyIntolerance` |
| `encounter` | `Encounter` |
| whole output | `Bundle` of type `collection`; plus `Provenance` pointing to the model version and source span |

Patient identifiers in the prototype are synthetic UUIDs only.

### 4.4 Vector and graph database setup

- **Vector store (pgvector or Chroma):** collections `terminology` (SNOMED/LOINC/ATC labels with embeddings for fuzzy code lookup, e.g. "heart attack" -> myocardial infarction), and `guideline_snippets` (short, public, citable text on dose ranges). Chunk size about 200 tokens, top-k = 5, metadata includes source and licence.
- **Graph store (optional):** nodes `Drug`, `Condition`, `Allergen`; edges `INTERACTS_WITH`, `CONTRAINDICATED_IN`, `TREATS`. Used for the "possible interaction" flag. If time-boxed out (see TIMELINE cut list), static tables replace it.
- **Relational tables:** `encounters`, `extractions` (JSON blob plus model version), `flags`, `reviews` (accept/edit/reject with timestamp), `audit_log`.

### 4.5 Evaluation

- Gold set: 20 synthetic notes with gold-standard structured answers written by Doc 1.
- Metrics: field-level precision and recall for problems, medications, observations; **schema-valid rate**; **hallucination rate** (extracted facts with no support in source text); **seeded-error detection** (wrong dose/unit cases correctly flagged); latency.
- All results reported with the number of cases, so the audience can judge the sample size.

## 5. Market and Clinical Impact, Pitch Value Proposition

### 5.1 Impact model (to be filled with measured data)

| Metric | How we calculate | Placeholder for slide |
|---|---|---|
| Time saved per patient | (manual structuring minutes) - (review-and-accept minutes), from timed trials on synthetic cases | **[measure]** minutes per note |
| Time saved per clinician-day | time saved per patient x patients per day (assume 15-25 for outpatient; state assumption) | derived from above |
| Error reduction | seeded dose/unit errors caught / seeded errors total | **[measure]** percent |
| Completeness gain | share of gold fields recovered | **[measure]** percent |

Rule for the pitch: show the formula and the assumption, then the number. Never claim savings we did not measure on our own cases.

### 5.2 Scalability across EU health systems

- **Standards-based output (FHIR R4)** aligns with the European EHR Exchange Format work under EHDS and the HL7 Europe profiles, so one pipeline can serve multiple Member States.
- **Language layer is swappable:** the schema is language-neutral; supporting German, French, or Dutch notes is a prompt and terminology-mapping extension, not a rebuild.
- **Deployment flexibility:** the model layer can run via an EU-region API or an on-premises open model, which suits hospital data-governance requirements.
- **Low integration cost:** a single REST endpoint and a FHIR Bundle fit existing integration engines.

### 5.3 Value proposition (one sentence for the pitch)

> "We turn the note a doctor already writes into a verified, standards-based FHIR record in seconds, flag anything unsafe or unsupported, and leave the clinician in control, giving time back to patients and making health data portable across Europe."

### 5.4 Pitch structure (5 minutes)

1. **Problem (45 s)** - Doc 2 with one patient-story hook; Doc 1 confirms from clinical practice.
2. **Live demo (90 s)** - synthetic note in, structured output out, a seeded wrong dose caught by the guardrail.
3. **How it works and why it is safe (60 s)** - schema, validation, grounding, human review.
4. **Results (45 s)** - measured numbers with sample size.
5. **Impact and EU scale-up (45 s)** - EHDS alignment, next steps, ask.

### 5.5 Risks and honest limitations

- Prototype evaluated only on synthetic notes written by the team; real-world performance is unknown.
- English only; terminology coverage is a small subset.
- LLM output is non-deterministic; mitigated with temperature 0, schema constraints, and rule-based checks, but not eliminated.
- Not validated clinically or certified; see `COMPLIANCE_AND_SAFETY.md`.
WHITEPAPER_EOF

# ---------------------------------------------------------------------------
# ROLES_AND_WORKFLOW.md
# ---------------------------------------------------------------------------
cat > organisations/ROLES_AND_WORKFLOW.md <<'ROLES_EOF'
# ROLES AND WORKFLOW

## 1. RACI Matrix

Legend: **R** = Responsible (does the work), **A** = Accountable (single owner, final say), **C** = Consulted (input before decision), **I** = Informed (told after). Each row has exactly one **A**.

| Deliverable / decision | Dev 1 (SE/API) | Dev 2 (DS/DB) | Dev 3 (AI) | Doc 1 (Clinical PO) | Doc 2 (Pitch) |
|---|---|---|---|---|---|
| Track selection and problem statement | C | C | C | **A/R** | C |
| Scope Lock document | I | C | C | **A/R** | C |
| Repo, CI, branch protection | **A/R** | I | I | I | I |
| FHIR subset and JSON Schema | C | **A/R** | C | C | I |
| Synthetic test cases and gold answers | I | C | C | **A/R** | I |
| Synthetic data generator | I | **A/R** | I | C | I |
| Database and vector/graph setup | C | **A/R** | C | I | I |
| API design and implementation | **A/R** | C | C | I | I |
| Prompts and model orchestration | C | C | **A/R** | C | I |
| Model selection and model card | I | C | **A/R** | C | I |
| Clinical guardrail rules (dose/lab ranges) | I | R | R | **A** | I |
| Guardrail code implementation | C | C | **A/R** | C | I |
| Evaluation harness and metrics | I | **A/R** | C | C | I |
| Clinical safety sign-off | I | I | C | **A/R** | I |
| Demo UI | **A/R** | I | C | C | C |
| Feature Freeze enforcement (12:30) | **A/R** | C | C | C | I |
| Slides and narrative | I | C | C | C | **A/R** |
| Demo script and video backup | R | C | C | C | **A** |
| README and architecture diagram | **A** | R | R | C | C |
| Compliance and disclaimer text | C | C | C | **A/R** | C |
| Code submission (form + tag) | **A/R** | C | C | I | I |
| Final pitch delivery | C | I | I | R | **A** |
| Conflict resolution on priorities | C | C | C | C | C |

**Tie-break rule:** clinical questions are decided by Doc 1; technical questions by the relevant Dev owner; schedule questions by Dev 1 as Technical Project Lead; narrative questions by Doc 2. If two areas collide, the Technical Project Lead decides within 5 minutes and logs a `DECISION:` message.

## 2. Code Review and Git Workflow (rapid-hacking edition)

### 2.1 Branching strategy

```
main              <- always runnable, protected, demo-ready
 |-- feat/<id>-<short-name>    e.g. feat/T08-extraction-prompt
 |-- fix/<id>-<short-name>     e.g. fix/T12-unit-normalisation
 |-- docs/<short-name>         e.g. docs/readme
 |-- release/v1.0-submission   cut at Feature Freeze (Fri 12:30)
```

Rules:
- Trunk-based: short-lived branches off `main`, merged back within **2 hours** at most.
- Branch name includes the task ID from `TIMELINE.md`.
- No long-running `dev` branch (it only creates merge pain in a 27-hour event).
- After Feature Freeze only `fix/*` and `docs/*` branches may merge, and only into `release/v1.0-submission`, then back to `main`.

### 2.2 Commits

- Format: `<type>(<task-id>): <summary>`, e.g. `feat(T09): wire LLM call to validation layer`.
- Types: `feat`, `fix`, `docs`, `test`, `chore`.
- Commit small and often; push at least hourly so no work lives only on one laptop.

### 2.3 Pull request rules

| Rule | Detail |
|---|---|
| Size | Aim for under 300 changed lines; split otherwise |
| Reviewers | 1 approval required; reviewer = anyone other than the author, preferably the consumer of the code |
| Review SLA | Review within **20 minutes** during working hours; ping in chat if not picked up |
| CI | Must be green (lint, unit tests, schema validation). Red CI blocks merge |
| Merge method | Squash merge to keep `main` history readable |
| Self-merge | Allowed **only** for `docs/*` and for fixes during the final 2 hours if reviewer is unavailable for 15 minutes; announce in chat |
| Secrets | Never commit API keys; use `.env` (git-ignored) and `.env.example` |
| Data | Only synthetic data in the repo; PRs containing anything resembling real patient data are rejected |
| Schema changes | Any change to `schemas/*.json` needs approval from Dev 2 **and** Dev 3, and a note in chat |
| Clinical rules changes | Any change to dose or lab range tables needs Doc 1 approval |

PR template (`.github/pull_request_template.md`):

```
## What and why
(1-2 sentences, link task ID e.g. T09)

## How to test
(commands or steps)

## Checklist
- [ ] CI green
- [ ] No secrets, no real patient data
- [ ] Schema/guardrail change? Tagged the right approvers
- [ ] Docs updated if behaviour changed
```

### 2.4 Review checklist (what reviewers actually look at)

1. Does it run? (pull branch, one command)
2. Does it respect the schema contract?
3. Are errors handled without leaking patient-like text to logs?
4. Is anything hard-coded that should be config?
5. Is there at least one test for the new behaviour?

### 2.5 Conflict and rollback

- Merge conflicts: the person whose branch is newer rebases on `main`.
- Broken `main`: whoever merged last reverts first (`git revert`), fixes later. Never debug on `main`.
- Tag known-good states: `v0.1-api-mvp` (Thu 24:00), `v0.2-guardrails` (Fri 09:30), `v1.0-submission` (Fri 15:00).

## 3. Inter-team Handoff Protocols

### 3.1 Medical leads -> AI engineer: synthetic test cases

**Goal:** Doc 1 supplies realistic but entirely fictional cases with known-correct answers so Dev 3 can tune prompts and Dev 2 can measure accuracy.

**File location and format:** `data/synthetic_cases/` with one pair of files per case:

- `case_###.txt` - the free-text note as a clinician would write it
- `case_###.gold.json` - the correct structured answer, following `schemas/clinical_note.schema.json`

**Case metadata** (header comment in the `.txt` file or `cases_index.csv`):

| Field | Meaning |
|---|---|
| `case_id` | e.g. `case_007` |
| `category` | `typical`, `edge`, `adversarial` |
| `trap` | what is being tested, e.g. "mg vs mcg", "negated diagnosis", "dose range ambiguity" |
| `expected_flags` | which review flags should fire, if any |
| `author` | Doc 1 or Doc 2 |
| `clinically_reviewed` | yes/no |

**Required case mix (minimum 20 by Fri 08:00):**

| Category | Count | Examples |
|---|---|---|
| Typical | 8 | Chronic disease follow-up; post-op review; routine GP visit |
| Edge | 6 | Abbreviations, shorthand ("bd", "o.d."), mixed units, lab values with ranges |
| Adversarial | 6 | Negation ("no chest pain"), history vs current, conflicting doses, implausible doses (10x error), missing units, drug-name look-alikes |

**Authoring rules for Doc 1 and Doc 2:**
1. Invent every patient. No case may be based on a real person, even loosely altered. No real names, dates of birth, addresses, or hospital identifiers.
2. Use realistic but fictional names like "Patient A", or generated names from a list.
3. Write the gold JSON from the note, not from memory, and mark each value's `source_span`.
4. Include at least 3 cases where the correct behaviour is **to flag, not to extract**.

**Delivery cadence**

| Time | Delivery | Receiver |
|---|---|---|
| Thu 21:00 | Batch 1: 10 cases (6 typical, 2 edge, 2 adversarial) | Dev 3, Dev 2 |
| Thu 24:00 | Batch 2: 10 more cases | Dev 3, Dev 2 |
| Fri 08:00 | Batch 3: red-team set | Dev 3 |

**Handoff steps**
1. Doc 1 commits cases to a `data/cases-batchN` branch and opens a PR titled `data(T05): synthetic cases batch N`.
2. Doc 1 posts in chat: `HANDOFF: cases batch N ready, categories X/Y/Z, known traps listed in cases_index.csv`.
3. Dev 3 acknowledges within 15 minutes and runs the evaluation harness on the new batch.
4. Dev 3 replies with: pass/fail per case, any case where the **gold answer itself looks wrong or ambiguous** (this is valuable feedback to Doc 1).
5. Doc 1 resolves ambiguities within 30 minutes: fix gold, or mark the case as "expected: flag for review".
6. Dev 2 includes the batch in the evaluation set once Doc 1 marks `clinically_reviewed = yes`.

### 3.2 AI engineer -> clinical lead: output review

- Dev 3 posts a review sheet (`docs/review_round_N.md`) with note, extracted output, and flags for the 5 most uncertain cases.
- Doc 1 grades each as **Correct / Acceptable / Unsafe** and comments in the PR. Any **Unsafe** blocks release until a guardrail or prompt fix is merged and re-reviewed.

### 3.3 Dev 2 <-> Dev 3: schema contract

- The JSON Schema is the contract. Changes require both approvals and a version bump (`schema_version` field).
- Dev 2 publishes example valid and invalid payloads; Dev 3 builds tests from them.

### 3.4 Dev 1 <-> everyone: API contract

- Dev 1 publishes the OpenAPI spec and a mock server early (Thu 20:00) so the UI and demo script can proceed before the real model path works.

### 3.5 Doc 2 <-> team: pitch inputs

- Dev 2 provides a one-page `docs/results_summary.md` (metrics, sample size, caveats) at Fri 11:30 and updates it once at Fri 12:30.
- Doc 1 provides 3 clinically accurate talking points and 5 likely judge questions with answers by Fri 11:00.
- Dev 1 provides a rehearsed 90-second demo path and a reset command.

### 3.6 Escalation

| Situation | Action |
|---|---|
| Blocked for more than 20 minutes | Post `BLOCKED:` in chat with what you tried |
| Disagreement on scope | Doc 1 decides on clinical value; Technical Project Lead decides on feasibility |
| Safety concern | Anyone can raise `SAFETY:`; work on the affected feature pauses until Doc 1 responds |
| Illness or absence | Cut list in `TIMELINE.md` section 5 applies; deputies: Dev 1 <-> Dev 3, Dev 2 <-> Dev 1, Doc 1 <-> Doc 2 |
ROLES_EOF

# ---------------------------------------------------------------------------
# COMPLIANCE_AND_SAFETY.md
# ---------------------------------------------------------------------------
cat > organisations/COMPLIANCE_AND_SAFETY.md <<'COMPLIANCE_EOF'
# COMPLIANCE AND SAFETY

**Scope of this document:** how the hackathon prototype handles data protection, how its AI output is constrained for clinical safety, and how it must be described to users and judges. This is an engineering and team policy document, not legal advice.

## 1. Data Privacy and GDPR / EHDS Alignment

### 1.1 Core policy: synthetic data only

1. **No real patient data enters the project, ever.** This covers the repository, the database, prompts, logs, screenshots, slides, and the demo video.
2. All clinical notes are **entirely fictional**, authored by Doc 1 and Doc 2, or generated by a synthetic-data tool. A case may not be derived from a real encounter, even with details changed.
3. No real names, birth dates, addresses, phone numbers, national IDs, insurance numbers, or hospital identifiers appear in any case. Patient identifiers in the system are random UUIDs.
4. If anyone suspects that real data has been pasted anywhere, they must say `PRIVACY:` in team chat. The item is deleted from the working tree, and the history is purged (see 1.5), and the incident is noted in `docs/privacy_log.md`.

### 1.2 Zero patient-PII retention by design

| Area | Control |
|---|---|
| Storage | Database holds synthetic records only; stored extraction results can be wiped with one command (`make reset-data`) |
| Logging | Application logs record request IDs, timings, schema-validation outcomes and flag codes, **not note text** |
| LLM provider | Only synthetic text is sent. API usage is configured without training on inputs where the provider offers that option; provider terms are recorded in `docs/model_card.md` |
| Secrets | API keys live in `.env` (git-ignored); `.env.example` has placeholders only |
| Demo | Demo environment is reset before the pitch; no browser autofill or history carrying personal data |
| Retention | Local databases and caches are deleted after the event unless the team keeps the synthetic set for open-source release |

### 1.3 Production alignment (what we would do beyond the hackathon)

| Regulation / principle | How the design maps to it |
|---|---|
| **GDPR Art. 5 (data minimisation, purpose limitation, storage limitation)** | Process only fields needed for structuring; no secondary use; configurable retention |
| **GDPR Art. 9 (special-category health data)** | Would require explicit legal basis (e.g. provision of healthcare, Art. 9(2)(h)) and a processing agreement with any model provider |
| **GDPR Art. 25 (privacy by design and default)** | Source-span logging off by default; pseudonymisation step before any external call |
| **GDPR Art. 32 (security)** | Encryption in transit and at rest, access control, audit log of who accepted or edited each record |
| **GDPR Art. 35 (DPIA)** | A data protection impact assessment would be completed before any real-world pilot |
| **EHDS (primary use of electronic health data)** | Output uses FHIR R4, the interoperable standard that underpins the European electronic health record exchange format effort; supports patient access and cross-border exchange |
| **EHDS (secondary use)** | Not implemented; if added, would use pseudonymised or anonymised data inside a secure processing environment under a data permit |
| **EU AI Act** | A system like this would likely be assessed as high-risk if used in clinical settings or as a medical device software; transparency, human oversight, logging, and accuracy documentation (model card, evaluation results) are built in now to ease later conformity work |
| **MDR (Regulation 2017/745)** | Any production version that influences clinical decisions may qualify as medical device software and would require appropriate classification and conformity assessment |

### 1.4 Data inventory

| Dataset | Source | Contains PII? | Where stored |
|---|---|---|---|
| Synthetic cases (`data/synthetic_cases/`) | Written by Doc 1 / Doc 2 | No | Repository |
| Generated patients | Synthetic generator by Dev 2 | No (random UUIDs, fictional attributes) | Local DB, git-ignored |
| Reference ranges and terminology subsets | Public sources, with licence noted | No | Repository (`data/reference/`) |
| Model outputs | Produced from synthetic input | No | Local DB, git-ignored |

### 1.5 Incident response (privacy)

1. Stop work on the affected item and notify the team (`PRIVACY:`).
2. Remove the data from the working tree and local database.
3. If committed: rewrite history with `git filter-repo` (or recreate the repository) and force-push, then confirm with all members that local clones are replaced.
4. If sent to an external API: record the provider, time, and content category in `docs/privacy_log.md`.
5. Doc 1 decides whether the incident requires disclosure to the organisers.

## 2. AI Clinical Guardrails

Principle: **the model proposes, deterministic code disposes, a clinician decides.** The model is never the last line of defence.

### 2.1 Output enforcement with JSON Schema

- Model calls use structured output / tool-calling bound to `schemas/clinical_note.schema.json`.
- Every response is validated again server-side with `jsonschema`. `additionalProperties: false` rejects invented fields.
- Enumerations restrict units, routes, and statuses (e.g. `dose_unit` in `mg|g|mcg|mL|IU|unit`).
- Numeric fields must be numbers, not strings; null is allowed when the note does not state the value, so the model is never pushed to invent one.
- Invalid output triggers a **repair loop** (max 2 attempts) with the validation error attached. A third failure goes to fallback (2.3).

### 2.2 Hallucination checks

| Check | How it works | Result on failure |
|---|---|---|
| **Source grounding** | Each extracted item must include a `source_span` that appears verbatim (after whitespace normalisation) in the input note | Item dropped and flagged `UNGROUNDED` |
| **Value-in-text check** | Numbers for dose and lab values must appear in the source span | Flagged `VALUE_NOT_IN_SOURCE` |
| **Unit normalisation** | Convert to canonical units (mcg/mg/g, mmol/L vs mg/dL) with explicit conversion table | Conversion logged; ambiguous units flagged `UNIT_AMBIGUOUS` |
| **Negation and temporality check** | Second-pass check on problems: "no", "denies", "history of", "family history" | Status set to `negated` / `historical` or flagged |
| **Cross-check** | Fast second model independently answers "is this fact stated in this sentence?" for each medication and lab value | Disagreement flagged `MODEL_DISAGREEMENT` |
| **Duplicate and conflict check** | Same drug with two different doses in one note | Flagged `CONFLICTING_DOSE` |

### 2.3 Medication dose and lab value validation (rule-based)

Reference tables in `data/reference/` are curated from public sources by Doc 1 and Dev 2, and approved by Doc 1.

**Medication rules**
- Drug name must resolve to a known ingredient (ATC/RxNorm subset). Unknown names are kept as text and flagged `DRUG_UNRECOGNISED`.
- Dose per administration and daily total are compared to a configured adult range per drug, e.g. `{"drug": "paracetamol", "unit": "mg", "single_max": 1000, "daily_max": 4000}`.
- Dose above `daily_max` or below a plausible minimum yields `DOSE_OUT_OF_RANGE` (severity high). A 10x factor between stated and typical dose raises `POSSIBLE_DECIMAL_ERROR`.
- Unit mismatches (e.g. levothyroxine in mg when the usual unit is mcg) raise `UNIT_MISMATCH`.
- Missing frequency or route raises `INCOMPLETE_ORDER` (severity low).
- Allergy cross-check: a medication in the same class as a documented allergy raises `ALLERGY_CONFLICT` (severity high).

**Laboratory rules**
- Analyte must map to a LOINC subset entry; unit must be compatible with the analyte (e.g. potassium in mmol/L).
- Value is checked against a physiologically plausible range (to catch typos or misplaced decimals), e.g. potassium 1.0-10.0 mmol/L; outside it raises `LAB_IMPLAUSIBLE`.
- Value outside the typical reference interval but plausible is **not** altered; it is passed through and optionally marked `ABNORMAL_REFERENCE` for display only.
- These rules never rewrite the data silently; they only add flags.

**Pediatric and special populations:** out of scope for the prototype. If age < 18 or pregnancy is detected in the note, the system adds `POPULATION_NOT_SUPPORTED` and skips dose range checks.

### 2.4 Fallback mechanisms

| Failure | Fallback behaviour |
|---|---|
| Model call timeout or error | Return `status: "needs_manual_entry"`, show original note, no partial guess |
| Schema validation fails after 2 repairs | Return `status: "needs_review"` with raw text and the validation error summary |
| Any high-severity flag | Item shown in red, **cannot be accepted with one click**; requires explicit clinician override with reason (logged) |
| Low grounding rate (>20% items ungrounded) | Whole extraction marked `LOW_CONFIDENCE`, banner shown |
| Guardrail service unavailable | Output blocked, not displayed (fail closed) |

### 2.5 Human oversight

- Every output is a **draft**. The UI states this, and nothing is exported as final until a clinician accepts it.
- The review screen shows source text beside each extracted item with highlighting.
- All accept / edit / reject actions are written to the audit log (user, time, item, flag state).

### 2.6 Safety testing and sign-off

1. Doc 1 maintains an adversarial set (see `ROLES_AND_WORKFLOW.md` 3.1) covering wrong units, 10x doses, negation, look-alike drugs, and conflicting statements.
2. Dev 2 runs the evaluation harness on each prompt or rule change.
3. Release gate (Milestone 4, Fri 09:30): **zero** seeded dangerous errors silently passed through (flag or fallback required for each), and schema-valid rate of 100% after repair-or-fallback. Doc 1 signs `docs/safety_signoff.md`.
4. Known limitations are listed openly in the README and pitch.

## 3. Disclaimer: Non-diagnostic, Advisory Use Only

The following text must appear in the README, in the application footer, on the first slide after the title, and in the demo video.

> **Important notice.** This software is a research and educational prototype created for the AIM Clinical AI Hackathon 2026. It is **not a medical device**, has **not been clinically validated**, and has **not been approved or certified** by any regulatory body. It is intended solely to demonstrate the structuring of **fictional, synthetic** clinical text.
>
> The output of this tool is **advisory and non-diagnostic**. It must **not** be used to diagnose, treat, monitor, or prevent any condition, to make or change a medication decision, or to replace the judgement of a qualified healthcare professional. All outputs may contain errors and must be reviewed and verified by a licensed clinician before any use.
>
> Do **not** enter real patient information or any personally identifiable data into this system. The authors accept no liability for any use of this software outside the hackathon demonstration context.

Short form for UI banners: *"Prototype, synthetic data only. Draft for clinician review. Not for clinical decision-making."*

## 4. Responsibilities

| Item | Owner |
|---|---|
| Privacy policy adherence and incident log | Doc 1 (A), all (R) |
| Guardrail rules and reference tables | Doc 1 (A), Dev 2, Dev 3 (R) |
| Guardrail code and tests | Dev 3 |
| Disclaimer present everywhere listed in section 3 | Dev 1 (UI, README), Doc 2 (slides, video) |
| Final safety sign-off | Doc 1 |
COMPLIANCE_EOF

echo "Created organisations/ with:"
ls -1 organisations
