# Compliance and safety

This page sets the team rules for data, messages, identity, and AI, and it holds the disclaimer. It is a team policy for a hackathon prototype, not legal advice.

## Synthetic data only

1. No real patient data enters the project. That covers the repository, the databases, Keycloak, Mailpit, logs, screenshots, slides, and the video.
2. Every person, organisation, phone number, email address, eHVD entry, and document is made up. The eHVD mock uses the real OID structure under `1.2.40.0.34.3.1.99.1` and `1.2.40.0.34.3.2.99.1`, but no entry is copied from the real directory. The scenario's `.example` addresses cannot receive mail, and the phone number is made up.
3. The request service sends email only to Mailpit, or through Gmail SMTP as ordysoftware@gmail.com only to the team inboxes in `MAIL_TEAM_INBOXES`. It sends SMS only to its own SMS screen. It never sends to any other real address or number.
4. The demo page `/inbox` shows every email in Mailpit with its working link, as Mailpit's own page does, to anyone who can reach the request service. A production build answers 404 there.
5. If anyone suspects real data somewhere, they post `PRIVACY:` in the team chat. We delete it from the working tree, purge it from git history if it was committed, and note the incident in `docs/privacy_log.md`.

## What an outgoing email or SMS may contain

The brief forbids the patient's name, the patient's birth date, and the document type in any email or SMS.

| Allowed | Forbidden |
|---|---|
| The requesting doctor's name and clinic | The patient's name |
| The link | The patient's birth date |
| The expiry date | The document type, such as "lab result" or "discharge report" |
| A note that ID Austria is needed | Anything from the request beyond the above |

The request service checks every message before sending. It splits the subject and the text into words and refuses to send if the message contains:

- any word of the patient's given or family names, except an initial of one letter
- the birth date as `1961-03-12`, `12.03.1961`, or `12 March 1961`
- a document type word from the document types table, such as `lab`, `labor`, `result`, `befund`, `rehab`, `discharge`, or `report`

The check compares whole words. A substring check would block every message, because "Beispiel" is part of "Klinikum Beispielstadt".

## Identity rules

- The outside person sees nothing about the patient or the document type until the identity check passes. That includes page titles, error messages, and file names.
- Error pages for a failed check say only that the request is for someone else.
- If Keycloak or the eHVD cannot be reached, the request service holds the request. It never treats a missing answer as a pass.
- A held identity or a held answer needs Dr. Hofer to click **Accept** in the workspace or optional widget. The audit log records who accepted and when, as `request_decided`.
- The workspace and optional widget show a held answer's text only to the network member who sent the request, so they can read it before they accept or reject it. Only `document.forRequest` returns it. It never goes into Matrix or the audit log.
- Three failed identity checks lock the link.

## Data we keep

| Data | Where | Why | How long |
|---|---|---|---|
| Requests | Postgres `requests`: document type, patient id, requested person, address, requester and their Matrix display name, state, link hash, the person number (bPK) of the person who passed or was held, and the ID token of that person's last login | Lifecycle and link checks. The bPK makes sure only that person can answer. The ID token goes into the Provenance at filing. | Until the demo reset |
| Person number bindings | Postgres `bindings` | Only the person who answered before can answer as that person again | Until the demo reset |
| Audit log | Postgres `audit_log`, including the document type, channel, and recipient address of each sent request | Who did what and when. No document text. | Until the demo reset |
| Filed answers | HAPI FHIR | The clinical record | Until the demo reset |
| Held answers, about the right patient | Postgres `held_answers`: the text, its hash, the sender's name and eHVD OID, their ID token, the hold reason, and the eHVD OIDs the release check found | Dr. Hofer decides about an answer the eHVD did not confirm | Until she accepts (then it is in HAPI) or rejects it, or the request is cancelled or expires |
| Answers whose filing outcome is unknown | Postgres `kept_answers`: the parsed document, the parties, the sender's ID token, and the upload hash | After a timeout the FHIR server may have filed it, so a retry must file exactly this answer | Until it is filed or the FHIR server refuses it, or the request is cancelled or expires |
| ID token of the sender | Provenance `signature.data`, and `requests.id_token` for the person the request is bound to | Proof of the identity check that anyone can verify later | With the record. In `requests` only while the request is open: filing, cancelling, rejecting, and expiry clear it |
| Uploads for the wrong patient | Nowhere. Only the SHA-256 hash and the reason stay in the audit log. | Max Beispiel's data must not end up in Maria's record or anywhere else | Discarded after the check |
| Name and person number of everyone who logs in at a link, whether the check passes, holds, or fails | Audit log | The audit needs to say who tried and who answered | Until the demo reset |
| Workspace Matrix access token | Authenticated encrypted `ordy_workspace_session` cookie, HttpOnly and SameSite=Lax. No JavaScript or browser-storage copy. | Authenticate an existing network member as a separate workspace device | At most eight hours; logout clears the cookie and requests revocation of that device only |
| Member chat messages | Synapse, in rooms the member has joined | Plaintext conversations alongside ordy notices. Synthetic data only. No E2EE or media support in the workspace. | Until the room is deleted; not copied into the request database |
| Notices in Dr. Hofer's Matrix room | Synapse: the requested person's name and organisation, and the ID Austria name of each person whose check failed or was held. Never a person number. | Dr. Hofer decides about held people and sees misdeliveries | Until the room is deleted. `pnpm reset` keeps the room. |
| IP address of whoever opens a link | Audit log, only as an HMAC with a key derived from `ORDY_SECRET`, cut to 16 hex characters. Nothing without a private `ORDY_SECRET`. | Hints which opens came from the same address without storing it. The client can forge the header it comes from, so it is no proof. | Until the demo reset |

The ID token holds the sender's name, birth date, and person number. That is more than the record strictly needs. We keep it because it is the only proof of the identity check that does not depend on trusting our own database. A production version could keep only a hash of the token and keep the token itself in a separate archive with stricter access.

Application logs hold request ids, timings, check results, and validator outcomes, never document text or patient names. The workspace gateway disables access logs and limits nginx errors to critical diagnostics, because request URLs can contain bearer links or clinical query inputs. External proxies must follow the logging guidance in [Deployment](DEPLOYMENT.md).

Workspace calls explicitly select their clinic cookie with `x-ordy-workspace: 1`. Outside-person requests retain the separate ID Austria path, including when both sessions exist in one browser. Joined-room checks apply to every chat read and send. Existing requester ownership and clinical release rules are unchanged.

`pnpm reset` (`scripts/reset.sh`) empties Postgres, HAPI, and Mailpit and reloads `patient.json`. We run it before the pitch.

## AI rules

AI is optional in this project. If we build the AI fallback parser:

- The model only reads documents. It never decides identity, the patient match, or whether an answer gets filed.
- Every value and every LOINC code it returns must appear word for word in the document. Otherwise the answer is held.
- An answer that the model read always waits until Dr. Hofer accepts it in the workspace or optional widget.
- We send only synthetic documents to the model provider and record the provider and model version in the README.

## Production alignment

| Rule | How the design maps to it |
|---|---|
| GDPR Art. 5, data minimisation | Outgoing email and SMS carry no patient data. Matrix chat uses synthetic data only. Uploads for the wrong patient are discarded. Logs hold no document text. |
| GDPR Art. 9, health data | Production needs a legal basis for healthcare provision and a processing agreement with any hosting party |
| GDPR Art. 25, privacy by design | The patient appears only after the identity check. The check fails closed. |
| GDPR Art. 32, security | Signed ID tokens, hashed link tokens, link expiry, a lock after three failed checks, and an audit log |
| GDPR Art. 35, impact assessment | A data protection impact assessment comes before any pilot with real data |
| eIDAS | ID Austria at level high is the identity source. We record the level in the Provenance. |
| EHDS, primary use | FHIR R4 output fits the European move toward exchangeable health records |
| ÄrzteG 1998 §§ 2, 3, 31, 49; MTD-Gesetz 2024 §§ 4, 5; KAKuG §§ 2, 7, 24 | Only the physician responsible for the content releases a document. The release check confirms that person in the eHVD, see [Identity and misdelivery](IDENTITY.md#who-may-release-a-document). Pending clinical sign-off, see [the review for issue #18](clinical-review/SIGNOFF_18_IDENTITY_AND_RELEASE.md). |
| ID Austria terms | Real use needs a registered service provider. [Identity and misdelivery](IDENTITY.md) has the steps. |
| eHVD terms | Real use needs a registration with the health ministry |

## Disclaimer

The README and the video show this text:

> **Important notice.** This software is a prototype built for the AIM hackathon 2026. It is not a medical device, it has not been clinically validated, and no regulatory body has approved or certified it. It uses fictional, synthetic data only. ID Austria and the eHVD are simulated.
>
> Do not use it to diagnose, treat, or monitor any condition, or to make any clinical decision. Do not enter real patient data or any personal data. The authors accept no liability for any use outside the hackathon demonstration.

## Responsibilities

| Item | Owner |
|---|---|
| Privacy rules and the incident log | Doc 1 is accountable, everyone follows them |
| Message content rule and its check | Dev 1 builds it, Doc 1 approves template changes |
| Identity rules | Dev 3 builds them, Doc 1 approves policy changes |
| AI rules | Dev 3 |
| Disclaimer everywhere it belongs | Dev 1 in the README and the app, Doc 2 in the video |
| Final safety sign-off | Doc 1 |

## Clinical review

Rules that need a clinician's decision wait in [`clinical-review/`](clinical-review/README.md), one file per issue. A clinician fills in the answer boxes by hand, and the file is committed with the answers. Open reviews:

- [Issue #18: identity rules and release check](clinical-review/SIGNOFF_18_IDENTITY_AND_RELEASE.md)
