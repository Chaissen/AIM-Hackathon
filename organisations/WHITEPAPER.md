# Whitepaper: Secure document requests from outside the network

**Track 2: Health Data Interoperability.** The requirements are in [`track/README.md`](../track/README.md) and the test data is in [`track/scenario/`](../track/scenario/).
This is a living document. Add comments inline as `> 💬 Name: ...`. Put larger ideas in section 9.

## 1. Problem and goal

Doctors in the closed PGK/Matrix network still get results from outside labs and rehab clinics by fax or unencrypted email, then retype them by hand.
**We build:** Dr. Hofer requests a document in Matrix. The outside person answers in the browser with no account and no install. Our service files the answer as valid FHIR R4 with Provenance and tells Dr. Hofer in Matrix.

## 2. Scope

**In:** Matrix bot command, email and SMS link (Mailpit plus a simulated SMS page), simulated ID Austria, an answer page (upload or form), Markdown → FHIR, HAPI FHIR storage, Matrix notification, audit log, misdelivery checks.
**Out:** our own Matrix app, end-to-end encryption, real email or SMS, a real eID, documents that are not in the scenario Markdown format.

**We are done when the jury metrics hold:**

| Metric | Target |
|---|---|
| HL7 validator errors on every filed resource | 0 |
| Effort for the outside person (request 1) | 0 installs, 0 accounts, under 2 min |
| Misdeliveries caught (M1–M3) | 3/3 |
| Audit coverage (6 steps, each with who/what/when) | 6/6 |

## 3. Flow

```
Dr. Hofer (Element) ──!request──▶ Bot ──▶ Service: create Task + one-time link ──▶ Email (Mailpit) / SMS page
                                                                                        │ [audit: request sent]
Outside person opens link [audit: link opened] ──▶ Simulated ID Austria [audit: identity checked]
   │  name must match the named recipient. If not: stop, show nothing, notify Dr. Hofer
   ▼
Answer page shows the request now ──▶ upload .md or fill the form (patient name + birth date) [audit: answer sent]
   ▼
Parse ─▶ patient match? ─no─▶ not filed, Matrix warning [audit: misdelivery caught]
   │ yes
   ▼
FHIR transaction Bundle ─▶ HAPI [audit: answer filed] ─▶ Matrix: "Lab result from Dr. Brandl filed ✓"
```

## 4. Architecture

| Component | Tech (proposal) | Replaceable by |
|---|---|---|
| Matrix server and client | Synapse + Element Web (Docker) | Conduit, any Matrix client |
| Request bot | Python, `matrix-nio` | An Element widget |
| Core service and answer portal | Python, FastAPI + HTML templates | – |
| Email | SMTP to Mailpit | Any SMTP provider, FTAPI |
| SMS | Our own "SMS inbox" page behind an `SmsSender` interface | Any SMS gateway |
| Identity | Simulated ID Austria (OIDC-style login page) behind an `IdentityProvider` interface | Real ID Austria or another eIDAS eID |
| FHIR server | HAPI FHIR (Docker, local) | Any FHIR R4 server |
| Audit | FHIR `AuditEvent` plus a local append-only log | SIEM, ATNA repository |
| Validation | `validator_cli.jar` in the metrics script; HAPI `$validate` before filing | – |

Everything runs with a single `docker compose up`.

## 5. Design answers (draft for the README)

1. **How does an outside person prove who they are without a directory?** Dr. Hofer names the person (for example "Dr. Eva Brandl") along with the contact. The link is possession proof only: single-use, random, expiring after 72 h. The outside person must also log in with an eID. The name the eID returns must match the named recipient. Nothing about the patient or the document is shown before that check passes.
2. **Which identity check for which document?** *Proposal:* eID for both. The lab result goes by email, which is easy to mistype or forward, so possession of the link proves nothing. The rehab report goes by SMS, a stronger possession factor, but a colleague could still pick up the phone and the scenario forbids colleagues from answering. ➜ *Team decision (D2).*
3. **Which FHIR resources and how are they linked?** See section 6.
4. **How do we notice a misdelivery?** See section 7.
5. **Where does it run?** *Proposal:* at the requesting clinic. The data never leaves the clinic's control, and the clinic already runs Matrix and FHIR. Only the answer portal is reachable from outside, over HTTPS.

## 6. FHIR model

```
Task (the request) ── for ─▶ Patient ◀── subject ── DiagnosticReport ── result ─▶ Observation ×4
  │ requester: Practitioner Hofer                    DocumentReference (rehab)
  │ owner: Practitioner Brandl / Kern
  └ output ─▶ DiagnosticReport | DocumentReference
Provenance ── target ─▶ all filed resources; agent = sender (onBehalfOf = their Organization);
              recorded = time; policy + signature = how identity was checked (eID, timestamp)
AuditEvent ×6 per request
```

| Answer | Resources |
|---|---|
| Lab result | `DiagnosticReport` (LOINC 11502-2 "Laboratory report", status final), one `Observation` per row: LOINC from the table, `valueQuantity` with UCUM units, `referenceRange`, `effectiveDateTime` = sample taken, `issued` = reported |
| Rehab report | `DocumentReference` (LOINC 18842-5 "Discharge summary"), Markdown attached as base64 `text/markdown` |
| Both | `Practitioner` and `Organization` for the sender, `Provenance`, `Task` updated to `completed`, all sent as one transaction `Bundle` |

Gotchas: `10^9/L` → UCUM `10*9/L`. INR has no unit, so it gets a value only. Times use `+02:00` (CEST on 22 Oct). The Patient comes from `patient.json`. On the public HAPI server it gets our own ID.

## 7. Misdelivery handling

| Test | What happens | Caught by |
|---|---|---|
| M1 wrong address (`labor-kanaI`) | The stranger opens the link and the eID name ≠ "Eva Brandl" → blocked, sees no patient or document type | Identity check, audit, Matrix warning |
| M2 forwarded to a colleague | The colleague's eID name ≠ the recipient → blocked, nothing filed | Identity check, audit, Matrix warning |
| M3 wrong patient (Max) | The document's patient and the form's patient ≠ the Task patient (name + birth date) → not filed | Patient match, audit, Matrix warning |
| Bonus | At send time, warn about lookalike domains (`I` vs `l`) and unknown domains | Bot |

## 8. Hard rules

- Synthetic data only.
- Emails and SMS contain no patient name, no birth date and no document type, only "Dr. Hofer, Klinikum Beispielstadt, sent you a secure request" plus the link.
- The portal shows the request details only after a successful identity check.
- Nothing is filed unless both the identity check and the patient match pass.
- Each external product sits behind an interface (email, SMS, eID, FHIR server).

## 9. Open decisions and team ideas

| # | Decision | Proposal | Owner | Decided |
|---|---|---|---|---|
| D1 | Answer by upload, form or both | Both: upload the .md and confirm the patient name and birth date in two fields | Doc 1 | |
| D2 | Identity level per document type | eID for both (see 5.2) | Doc 1 + Dev 3 | |
| D3 | Use AI? | Optional: extract the rehab medications into `MedicationStatement`, only if they are 100 % correct on the scenario | Dev 3 | |
| D4 | M2 behaviour: block or file-but-flag | Block, and tell Dr. Hofer who tried | Doc 1 | |
| D5 | Where it runs | At the clinic (see 5.5) | All | |

> 💬 Add ideas and comments here.
