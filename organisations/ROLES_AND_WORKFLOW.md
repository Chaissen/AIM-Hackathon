# Roles and workflow

## Ownership

A is accountable and has the final say. R does the work. C is consulted before a decision. I is told afterwards. Each row has one A.

| Deliverable | Dev 1 | Dev 2 | Dev 3 | Doc 1 | Doc 2 |
|---|---|---|---|---|---|
| Scope and these docs | C | C | C | **A/R** | C |
| Docker setup and Keycloak realm | **A/R** | I | C | I | I |
| Request service, outside portal, email and SMS | **A/R** | C | C | C | I |
| Matrix bot | C | I | **A/R** | C | I |
| Parser and patient check | I | C | **A/R** | C | I |
| Identity checks and mock eHVD | C | I | **A/R** | C | I |
| Identity policy per document type | C | I | C | **A/R** | I |
| FHIR mapping, Provenance, Task | I | **A/R** | C | C | I |
| Validation and metric scripts | I | **A/R** | C | I | I |
| Test documents and misdelivery runs | I | R | C | **A/R** | I |
| Clinical review of the filed FHIR data | I | C | I | **A/R** | I |
| Timed test with someone new | C | I | I | C | **A/R** |
| README and design answers | R | R | R | C | **A** |
| Demo script and video | R | C | C | C | **A/R** |
| Disclaimer in README, app, and video | R | I | I | **A** | R |
| Submission | **A/R** | C | C | I | C |

Doc 1 decides clinical questions. The owning developer decides technical questions. Dev 1 decides schedule questions as technical lead. Doc 2 decides narrative questions. If two areas collide, Dev 1 decides within 5 minutes and posts a `DECISION:` message.

## Git workflow

### Branches

```
main                        always runnable and demo-ready
 |-- feat/<id>-<name>       for example feat/T08-name-match
 |-- fix/<id>-<name>        for example fix/T12-ucum-units
 |-- docs/<name>            for example docs/design-answers
 |-- release/submission     cut at feature freeze
```

- Branch off `main` and merge back within 2 hours.
- Put the task id from [Timeline](TIMELINE.md) in the branch name.
- After feature freeze, only `fix/*` and `docs/*` branches merge, into `release/submission` first and then into `main`.

### Commits

- Format: `<type>(<task id>): <summary>`, for example `feat(T08): match requested name against ID Austria name`.
- Types: `feat`, `fix`, `docs`, `test`, `chore`.
- Push at least every hour, so no work lives only on one laptop.

### Pull requests

| Rule | Detail |
|---|---|
| Size | Under about 300 changed lines. Split bigger changes. |
| Review | One approval from someone other than the author, ideally the person who uses the code |
| Review time | Within 20 minutes. Ping in the team chat if nobody picks it up. |
| Checks | Lint and tests must pass. Changes to the FHIR mapper also need 0 validator errors on the scenario documents. |
| Merge | Squash merge |
| Self-merge | Only for `docs/*`, and for fixes in the last 2 hours when no reviewer answers within 15 minutes. Announce it in the chat. |
| Secrets | Never commit secrets. Use `.env`, which git ignores, and keep placeholders in `.env.example`. |
| Data | Synthetic data only. Reject any pull request with data that looks real. |
| Identity rules | Changes to the name match, the patient check, or the identity policy need approval from Dev 3 and Doc 1. |
| Message templates | Changes to the email or SMS text need approval from Doc 1. |

Reviewers check five things:

1. It runs with one command.
2. Nothing about the patient reaches the outside person before the identity check passes.
3. Logs and audit entries hold no document text.
4. Nothing is hardcoded that belongs in configuration.
5. New behaviour has at least one test.

### Broken main

The person who merged last reverts first with `git revert` and fixes afterwards. Nobody debugs on `main`. Tag good states: `v0.1-happy-path` at Thu 24:00, `v0.2-misdelivery` at Fri 09:30, and `v1.0-submission` at Fri 15:00.

## Handoffs

### Test documents from Doc 1

The jury tests with other outside people and other documents in the scenario's Markdown format, some for the wrong patient. Doc 1 writes our own set first.

Location: `track/scenario/extra/`, one Markdown file per document, in the format of `track/scenario/documents/`. An index file `track/scenario/extra/index.md` lists for each document:

| Field | Meaning |
|---|---|
| File | For example `lab-result-anna-test.md` |
| Kind | Lab result or rehab report |
| Patient | Name and birth date in the document |
| Sender | The outside person who uploads it |
| Expected | Filed, held, or blocked, and why |
| Trap | What it tests, for example a double family name, a second given name, a unit like `10^12/L`, or a range written as `< 5` |

Minimum set by Fri 07:30:

- 3 lab results for Maria with other tests, units, and LOINC codes
- 2 rehab reports with a stay that spans two months
- 3 documents for other patients, one of them with the same family name and a different birth date
- 2 new outside people with double names, created on the Keycloak sign-up page

Steps:

1. Doc 1 commits to a `data/extra-docs` branch and opens a pull request titled `data(T16): extra test documents`.
2. Doc 1 posts `HANDOFF: extra documents ready` in the chat.
3. Dev 3 runs the parser and the patient check on every file within 30 minutes and reports any mismatch with the expected result.
4. Doc 1 fixes the document or the expectation. A wrong expectation is useful feedback too.

### Clinical review of the FHIR data

Dev 2 posts the filed resources for each test document as a link to the HAPI server or as JSON files. Doc 1 checks:

- Units and reference ranges match the document.
- `H`, `L`, and `N` match the values.
- The rehab report names the right author and sender.
- The Provenance narrative says who sent it and how their identity was checked.

Doc 1 grades each answer as correct, acceptable, or unsafe. An unsafe grade blocks the release until a fix is merged and reviewed again.

### Demo path from Dev 1

Dev 1 provides a reset command that empties SQLite, HAPI, and Mailpit, and reloads the patient. Dev 1 also provides a rehearsed path through both requests and the three misdelivery tests.

### Escalation

| Situation | Action |
|---|---|
| Blocked for more than 20 minutes | Post `BLOCKED:` with what you tried |
| Disagreement on scope | Doc 1 decides on clinical value, and Dev 1 decides on feasibility |
| Safety or privacy concern | Anyone posts `SAFETY:` or `PRIVACY:`. Work on the affected part pauses until Doc 1 answers. |
| Someone drops out | Apply the cut list. Deputies are Dev 1 and Dev 3 for each other, Dev 2 for Dev 1, and Doc 1 and Doc 2 for each other. |
