# Demo script (draft)

A draft click path for the 2-minute video and the live demo, written for the pitch team. Doc 2 owns the final script and the video (T21). The track asks the video to say what works and what does not, so the last scene does that.

The steps follow the documented target behaviour in [Architecture](ARCHITECTURE.md) and [Identity and misdelivery](IDENTITY.md). The screen texts are the ones in the code where it exists. Each step has a state:

- **Ready**: works on `main` today.
- **Partly**: the screen exists, but the data or the action behind it does not yet.
- **Not built**: waits for the tasks named. [Timeline](TIMELINE.md) has the owners.

States as of 30 October 2026, morning. Check them again on the frozen build before recording, and cut or replace every step that is still not built.

## Order of the story

The request lifecycle sets the order. A filed request accepts no further login, so the forwarded link (M2) and the wrong patient (M3) must happen on request 1 before the right answer is filed. M1 needs its own request, because it goes to a different address.

| Scene | Time | Seconds | What it shows |
|---|---|---|---|
| 1 | 0:00 to 0:08 | 8 | The problem and Dr. Hofer's room |
| 2 | 0:08 to 0:26 | 18 | Request 1: lab result by email |
| 3 | 0:26 to 0:36 | 10 | M2: a colleague opens the forwarded link |
| 4 | 0:36 to 0:46 | 10 | Dr. Brandl logs in with ID Austria |
| 5 | 0:46 to 0:54 | 8 | M3: she uploads the result of another patient |
| 6 | 0:54 to 1:06 | 12 | She uploads the right result, and it is filed as FHIR |
| 7 | 1:06 to 1:20 | 14 | M1: the mistyped address |
| 8 | 1:20 to 1:36 | 16 | Request 2: rehab report by SMS |
| 9 | 1:36 to 1:52 | 16 | Audit log, metrics, what works and what does not |
| 10 | 1:52 to 2:00 | 8 | Disclaimer and repository link |

The request numbers in the notices follow the order the requests are created after `pnpm reset`. In this order, the lab request is request 1, the M1 request is request 2, and the rehab request is request 3.

## Before recording

1. Record on the frozen build. Run `pnpm reset`, then `pnpm dev`.
2. Open these tabs: Element at http://localhost:8081 logged in as `lena.hofer` / `hofer-demo-2026` with the room "Dr. Hofer · Outside documents" and the ordy widget open, Mailpit at http://localhost:8025, the SMS screen at http://localhost:3010/sms, and HAPI FHIR at http://localhost:8090/fhir.
3. Use a separate private browser window for each outside person, so no session cookie carries over.
4. Keep the files ready: `track/scenario/documents/lab-result-maria-beispiel.md`, `lab-result-max-beispiel.md`, and `rehab-report-maria-beispiel.md`.
5. Fill forms off camera or speed up typing in the edit. Two minutes leave no time for typing.
6. Show only synthetic data. No real names, addresses, or phone numbers on screen, including browser history and bookmarks.

## Scene 1: the problem (8 s)

| Click | What you see | State |
|---|---|---|
| Show Element with Dr. Hofer's room and the pinned ordy widget | The room "Dr. Hofer · Outside documents" with the widget | Ready |

Say: Labs and rehab clinics outside the PGK network still answer by fax or email, and someone types the scans in by hand. Dr. Hofer needs Maria Beispiel's clotting tests before a procedure.

## Scene 2: request 1, lab result by email (18 s)

| Click | What you see | State |
|---|---|---|
| In the widget, pick **Lab result**, patient Maria Beispiel, Eva Brandl, Labor Kanalstraße, `eva.brandl@labor-kanal.example`, then **Send request** | The form, then the notice "Request 1 sent to Dr. Eva Brandl (Labor Kanalstraße) by email." in the room | Partly: the form works, sending is not built (T04, T05, T06) |
| Open the email in Mailpit | "Secure request from Klinikum Beispielstadt", the link, the expiry date. No patient name, no birth date, no document type. | Not built (T06) |

Say: The email names only Dr. Hofer and the clinic. Nobody who intercepts it learns about the patient.

## Scene 3: M2, forwarded link (10 s)

| Click | What you see | State |
|---|---|---|
| In a private window, open the link from the email | "Dr. Lena Hofer at Klinikum Beispielstadt sent you a request" and **Log in with ID Austria**. Nothing about the patient. | Partly: the page exists, loading the request is not built (T04) |
| Log in as `thomas.wagner` / `demo-thomas`, Dr. Brandl's colleague | "This request is for someone else. Nothing was shared with you." | Partly: the check is built (T08), the login is not (T07) |
| Switch to Element | "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Thomas Wagner). Nothing was shown or filed. Check the address." | Partly: the notice text is built, the login is not (T07) |

Say: A forwarded link is useless. Only the person Dr. Hofer named can open it.

## Scene 4: Dr. Brandl logs in (10 s)

| Click | What you see | State |
|---|---|---|
| In a new private window, open the same link and click **Log in with ID Austria** | The Keycloak login titled "ID Austria (Simulation)" | Partly: the Keycloak realm works, ordy's login is not built (T07) |
| Log in as `eva.brandl` / `demo-eva` | The answer page: "Lab result for Maria Beispiel, born 12 March 1961", an upload field, and fields for the patient's name and birth date | Partly: the page exists, loading its data is not built (T04, T07) |

Say: ID Austria is simulated here. Real ID Austria also asks for a confirmation in the phone app, which we do not simulate.

## Scene 5: M3, wrong patient (8 s)

| Click | What you see | State |
|---|---|---|
| Upload `lab-result-max-beispiel.md`, type Maria Beispiel and 12 March 1961 in the form, send | "This document is about a different patient. Check the file and upload again." | Partly: the parser and the patient check are built (T10, T11), the upload is not (T09) |
| Switch to Element | "The answer to request 1 is about a different patient. Name and birth date do not match Maria Beispiel. Nothing was filed." | Partly: the notice text is built, the upload is not (T09) |

Say: The notice never names the other patient, and the upload is discarded.

## Scene 6: the right answer is filed (12 s)

| Click | What you see | State |
|---|---|---|
| Upload `lab-result-maria-beispiel.md` with Maria Beispiel and 12 March 1961, send | A confirmation that the answer was sent | Not built (T09) |
| Switch to Element | "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range." | Partly: the notice text is built, filing is not (T12, T13) |
| Open HAPI FHIR | One DiagnosticReport with four Observations and their LOINC codes (INR, aPTT, platelets, fibrinogen), and a Provenance that holds the ID Austria token | Not built (T12, T13) |

Say: Dr. Hofer gets structured values she can trend and reuse, not a scan, and the Provenance proves who sent them.

## Scene 7: M1, mistyped address (14 s)

| Click | What you see | State |
|---|---|---|
| In the widget, send the same lab request to `eva.brandl@labor-kanaI.example`, with a capital I | The warning "The address domain `labor-kanaI.example` does not match Labor Kanalstraße (`labor-kanal.example`)." next to **Send anyway** and **Cancel** | Not built (T05, T15) |
| Click **Send anyway**, open the new email in Mailpit, and open its link in a private window | Only the requesting doctor and clinic | Not built (T04, T06) |
| Log in as `anna.huber` / `demo-anna`, who owns the mistyped address | "This request is for someone else. Nothing was shared with you." | Partly: the check is built (T08), the login is not (T07) |
| Switch to Element | "Request 2 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address." | Partly: the notice text is built, the login is not (T07) |

Say: ordy warns before sending, and even if Dr. Hofer sends anyway, the stranger sees nothing.

## Scene 8: request 2, rehab report by SMS (16 s)

| Click | What you see | State |
|---|---|---|
| In the widget, pick **Rehab discharge report**, Stefan Kern, Reha Waldblick, `+43 660 000 0101`, send | The form switches to SMS. The notice "Request 3 sent to Stefan Kern (Reha Waldblick) by SMS." | Partly: the form works, sending is not built (T04, T05, T06) |
| Open the SMS screen and the link in it | The SMS on a phone frame, then the landing page | Partly: the SMS screen exists, the SMS log is not built (T06) |
| Log in as `stefan.kern` / `demo-stefan`, upload `rehab-report-maria-beispiel.md` with Maria Beispiel and 12 March 1961, send | The answer page, then a confirmation | Not built (T07, T09) |
| Switch to Element and HAPI | "Rehab discharge report for Maria Beispiel from Stefan Kern is filed. Identity checked with ID Austria." and a DocumentReference with the report attached | Partly: the notice text is built, filing is not (T13, T14) |

Say: Stefan Kern only sends the report. The Provenance names Dr. Leitner, who wrote it, as author and Stefan Kern as informant.

## Scene 9: audit log, metrics, and limits (16 s)

| Click | What you see | State |
|---|---|---|
| Open the **Audit log** tab in the widget | The entries of request 1 with all six event types: `request_sent`, `link_opened`, `identity_checked`, `answer_sent`, `answer_filed`, `misdelivery_caught` | Partly: the tab works, the request flow does not write entries yet (T04) |
| Show the metric results from the README | FHIR validation, effort, misdeliveries, and audit coverage | Not built (T17, T18, T19) |

Say what works and what does not, from the frozen build and the README status. Always say that ID Austria is simulated with Keycloak and has no phone-app step, that the eHVD is our mock, and that email and SMS go to Mailpit and the SMS screen.

## Scene 10: disclaimer (8 s)

Show the disclaimer from [Compliance and safety](COMPLIANCE_AND_SAFETY.md#disclaimer) as a closing card, with the repository link. The video must show it.

## If the time runs short

Cut in this order and say in the video what was cut:

1. Scene 8, request 2. Mention it in one sentence.
2. The HAPI view in scene 6. The Matrix notice alone shows the filing.
3. The Mailpit step in scene 7. Go from the warning straight to Anna Huber's login.
