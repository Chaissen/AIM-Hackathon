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
