# End-to-end run, 30 October 2026

A browser run of the whole scenario on `main` at commit `4b79591` (#68), from 11:16 to 11:25 UTC. An agent drove a real Chromium through the workspace, Mailpit, the SMS screen, the simulated ID Austria, the portal, HAPI FHIR, and Element Web, and recorded it. The database started empty. All data is synthetic.

The recording (9 min 7 s, 1440x900), 51 screenshots, and the logs stay outside git, on the machine that ran it, in `~/Movies/ordy-e2e/`.

## Steps

| Step | Result | What the run showed |
|---|---|---|
| 1. Workspace login | Pass | Dr. Hofer signed in at http://localhost:8081. `!status` in Messages got the bot's reply. |
| 2. Request 1, lab result by email | Pass | **New request**, **Examples**, "Lab result from Dr. Brandl", **Send request**. |
| 3. The email | Pass | Mailpit and `/inbox` had the email. It named no patient, no birth date, and no document type. Neither did the portal landing page. |
| 4. Dr. Brandl answers | Pass | Eva Brandl logged in through the simulated ID Austria, uploaded Maria Beispiel's lab result, confirmed the patient, and got the filed confirmation. |
| 5. Filing | Pass | The workspace showed the request as received, Messages had the filed notice, and HAPI held one DiagnosticReport, four Observations, and one Provenance for Maria. |
| 6. Request 2, rehab report by SMS | Pass | The SMS to `+43 660 000 0101` was in `sms_outbox`, on `/sms`, and on `/inbox`, with no patient data and a working link. Stefan Kern logged in, uploaded the rehab report, and it was filed. The Provenance names Dr. Johanna Leitner as author and Stefan Kern as informant. |
| 7. M1, wrong address | Pass | `labor-kanaI.example` got the address warning and held request 3. After **Send anyway**, Anna Huber saw only the neutral landing page and the refusal. Nothing was answered or filed. The audit log has `address_mismatch` and `wrong_person`, and Messages has the notice. |
| 7. M2, forwarded link | Pass | Thomas Wagner opened request 1's link and was turned away, with no patient data and no upload. The audit log has a failed `identity_checked` and `wrong_person`. |
| 7. M3, wrong patient | Pass | Eva Brandl uploaded Max Beispiel's document while entering Maria's details. The upload was stopped, and HAPI had no DiagnosticReport for Maria before the right upload. The notice did not name Max. The audit log kept the file's SHA-256 and size, not its text. |
| 8. Element Web | Pass | Dr. Hofer's room at http://localhost:8082 showed the pinned ordy widget, which worked after the identity approval. |
| 9. Metric commands | Fail | `pnpm validate` and `pnpm audit:check` passed. `pnpm scenario` exited 1, because its six flow steps have no code yet. |

M2 and M3 ran on request 1 before it was filed, as [Demo](DEMO.md) requires, because a filed request takes no other login.

## Metrics

| Metric | Target | Result |
|---|---|---|
| FHIR validation | 0 errors | 0 errors in 18 resources (HL7 validator 7.0.3). 16 warnings, all about missing narratives. |
| Effort for the outside person | Under 2 minutes, 0 installs, 0 accounts | 41.1 s from Eva Brandl's `link_opened` to the `answer_sent` that was filed, including the M3 refusal. This was a scripted run, not the stopwatch test with someone new. That test is still open. |
| Misdeliveries caught | 3 of 3 | 3 of 3 |
| Audit coverage | 6 of 6 on request 1 | 6 of 6. Request 2 has 5 of 6, without `misdelivery_caught`, because no misdelivery was tried on it. |

## Findings

1. The request form promises a review that does not happen. For the rehab request, it says "Stefan Kern is not in the healthcare directory. You will review the answer before it goes into the record." The report was then filed without a review, because the release check looks at the physician responsible for the document, Dr. Johanna Leitner, and she passed. The text comes from `REVIEW` in `src/app/widget/request-form.tsx`. The release decision is in `src/server/answers/submit.ts`. Not fixed yet.
2. `pnpm scenario` cannot run the flow, because its steps have no code that drives it. [Metrics](../README.md#metrics) already says so.

## Checks on the same commit

`pnpm typecheck`, `pnpm lint`, and `pnpm build` passed, and `pnpm test` passed 530 of 530 with none skipped.
