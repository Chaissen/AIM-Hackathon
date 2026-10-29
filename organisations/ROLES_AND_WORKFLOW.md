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
