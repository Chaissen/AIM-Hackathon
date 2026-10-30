# Demo script (draft)

A draft click path for the 2-minute video and the live demo, written for the pitch team. Doc 2 owns the final script and the video (T21). The track asks the video to say what works and what does not, so scene 9 does that.

The steps follow the documented target behaviour in [Architecture](ARCHITECTURE.md) and [Identity and misdelivery](IDENTITY.md). The screen texts are the ones in the code where they exist. Each step has a state:

- **Ready**: works on `main` today.
- **Partly**: the screen exists, but the data or the action behind it does not yet.
- **Not built**: waits for the tasks named. [Timeline](TIMELINE.md) has the owners.

States as of 30 October 2026, 02:00, with the filing (T13) and the metric runner (T17, T18) on `main`. Check them again on the frozen build before recording. Cut every step that is still not built, or replace it with one spoken sentence. If you show a screen from `prototype/ordy-app`, label it on screen as a design mock-up, not the running app.

The notices below quote the names as [Architecture](ARCHITECTURE.md#matrix-bot) writes them, for example "Dr. Eva Brandl". The request form has no title field, so check on the frozen build how the notices write the names.

## Order of the story

The request lifecycle sets the order. A filed request accepts no further login, so the forwarded link (M2) and the wrong patient (M3) must happen on request 1 before the right answer is filed. M1 needs its own request, because it goes to a different address. It runs last, so the rehab request keeps the number 2, as in the track.

| Scene | Time | Seconds | What it shows |
|---|---|---|---|
| 1 | 0:00 to 0:06 | 6 | The problem and Dr. Hofer's room |
| 2 | 0:06 to 0:22 | 16 | Request 1: lab result by email |
| 3 | 0:22 to 0:32 | 10 | M2: a colleague opens the forwarded link |
| 4 | 0:32 to 0:40 | 8 | Dr. Brandl logs in with ID Austria |
| 5 | 0:40 to 0:48 | 8 | M3: she uploads the result of another patient |
| 6 | 0:48 to 1:00 | 12 | She uploads the right result, and it is filed as FHIR |
| 7 | 1:00 to 1:14 | 14 | Request 2: rehab report by SMS |
| 8 | 1:14 to 1:24 | 10 | M1: the lab request to a mistyped address |
| 9 | 1:24 to 1:52 | 28 | Audit log, metrics, what works and what does not |
| 10 | 1:52 to 2:00 | 8 | Disclaimer and repository link |

The notices number the requests in the order they are created after `pnpm reset`: the lab request is request 1, the rehab request is request 2, and the M1 request is request 3. In the voice-over, call M1 "the lab request, sent to a mistyped address".

## Before recording

1. Record on the frozen build. Run `pnpm reset`, then `pnpm dev`.
2. `pnpm reset` keeps the Matrix room and the notices from rehearsals. For a clean room, set a new `MATRIX_ROOM_ALIAS` in `.env`, run `pnpm matrix:bootstrap`, restart `pnpm dev`, and leave the old room in Element.
3. Open these tabs: Element at http://localhost:8081 logged in as `lena.hofer` / `hofer-demo-2026` with the room "Dr. Hofer · Outside documents" and the ordy widget open, Mailpit at http://localhost:8025, the SMS screen at http://localhost:3010/sms, and HAPI FHIR at http://localhost:8090/fhir.
4. Only the first notice of a request shows in the room timeline. Later notices go into that request's thread, so open the thread to show them.
5. Private windows of one browser share their cookies. Close every private window before you switch to the next outside person, or use a separate browser profile for each person.
6. Keep the files ready: `track/scenario/documents/lab-result-maria-beispiel.md`, `lab-result-max-beispiel.md`, and `rehab-report-maria-beispiel.md`.
7. Fill forms off camera or speed up typing in the edit. Two minutes leave no time for typing.
8. Show only synthetic data. No real names, addresses, or phone numbers on screen, including browser history and bookmarks.

## Scene 1: the problem (6 s)

| Click | What you see | State |
|---|---|---|
| Show Element with Dr. Hofer's room and the pinned ordy widget | The room "Dr. Hofer · Outside documents" with the widget | Ready |

Say: Outside labs still answer by fax. ordy lets Dr. Hofer ask from her Matrix room.

## Scene 2: request 1, lab result by email (16 s)

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
| Switch to Element and open the thread of request 1 | "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Thomas Wagner). Nothing was shown or filed. Check the address." | Partly: the notice text is built, the login is not (T07) |

Say: A forwarded link is useless. Only the person Dr. Hofer named can open it.

## Scene 4: Dr. Brandl logs in (8 s)

| Click | What you see | State |
|---|---|---|
| Close the private window, open the same link in a new one, and click **Log in with ID Austria** | The Keycloak login titled "ID Austria (Simulation)" | Partly: the Keycloak realm works, ordy's login is not built (T07) |
| Log in as `eva.brandl` / `demo-eva` | The answer page: "Lab result for Maria Beispiel, born 12 March 1961", an upload field, and fields for the patient's name and birth date | Partly: the page exists, loading its data is not built (T04, T07) |

Say: ID Austria is simulated here.

## Scene 5: M3, wrong patient (8 s)

| Click | What you see | State |
|---|---|---|
| Upload `lab-result-max-beispiel.md`, enter Maria Beispiel and 12 March 1961 in the form, send | "This document is about a different patient. Check the file and upload again." | Partly: the parser and the patient check are built (T10, T11), the upload is not (T09) |
| Switch to Element and open the thread of request 1 | "The answer to request 1 is about a different patient. Name and birth date do not match Maria Beispiel. Nothing was filed." | Partly: the notice text is built, the upload is not (T09) |

Say: She entered Maria's details, but the file is about Max Beispiel. The notice never names him, and the upload is discarded.

## Scene 6: the right answer is filed (12 s)

| Click | What you see | State |
|---|---|---|
| Upload `lab-result-maria-beispiel.md`, enter Maria Beispiel and 12 March 1961, send | A confirmation that the answer was sent | Partly: the answer form exists, sending it is not built (T09) |
| Switch to Element and open the thread of request 1 | "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range." | Partly: the notice text and the filing Bundle are built (T13), the upload, the lab mapper, and the release check are not (T09, T12, T15) |
| Open HAPI FHIR | One DiagnosticReport with four Observations and their LOINC codes (INR, aPTT, platelets, fibrinogen), and a Provenance that holds the ID Austria token | Not built: the lab mapper (T12) and the upload (T09). The filing Bundle with Provenance and Task is built (T13) but not connected. |

Say: Dr. Hofer gets structured values she can trend and reuse, not a scan, and the Provenance proves who sent them.

## Scene 7: request 2, rehab report by SMS (14 s)

| Click | What you see | State |
|---|---|---|
| In the widget, pick **Rehab discharge report**, Stefan Kern, Reha Waldblick, `+43 660 000 0101`, send | The form switches to SMS. The notice "Request 2 sent to Stefan Kern (Reha Waldblick) by SMS." | Partly: the form works, sending is not built (T04, T05, T06) |
| Open the SMS screen and the link in it | The SMS on a phone frame, then the landing page | Partly: the SMS screen exists, the SMS log is not built (T06) |
| Log in as `stefan.kern` / `demo-stefan`, upload `rehab-report-maria-beispiel.md`, enter Maria Beispiel and 12 March 1961, send | The answer page, then a confirmation | Partly: the answer page and form exist, the login and the upload are not built (T07, T09) |
| Switch to Element, open the thread of request 2, then HAPI | "Rehab discharge report for Maria Beispiel from Stefan Kern is filed. Identity checked with ID Austria." and a DocumentReference with the report attached | Partly: the notice text and the filing Bundle (T13) are built, the upload, the rehab mapper, and the release check are not (T09, T14, T15) |

Say: Stefan Kern only sends the report. The Provenance names Dr. Leitner, who wrote it, as author and Stefan Kern as informant.

## Scene 8: M1, mistyped address (10 s)

| Click | What you see | State |
|---|---|---|
| In the widget, send the lab request again to `eva.brandl@labor-kanaI.example`, with a capital I | The warning "The address domain `labor-kanaI.example` does not match Labor Kanalstraße (`labor-kanal.example`)." next to **Send anyway** and **Cancel** | Not built (T05, T15) |
| Click **Send anyway**. Off camera, open the new email in Mailpit and its link in a fresh private window. | Only the requesting doctor and clinic | Not built (T04, T05, T06) |
| Log in as `anna.huber` / `demo-anna`, who owns the mistyped address | "This request is for someone else. Nothing was shared with you." | Partly: the check is built (T08), the login is not (T07) |
| Switch to Element and open the thread of request 3 | "Request 3 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address." | Partly: the notice text is built, the login is not (T07) |

Say: ordy warns before sending, and even if Dr. Hofer sends anyway, the stranger sees nothing.

## Scene 9: audit log, metrics, and limits (28 s)

| Click | What you see | State |
|---|---|---|
| Open the **Audit log** tab in the widget | The entries of request 1 with all six event types: "Request sent", "Link opened", "Identity checked", "Answer sent", "Answer filed", and "Misdelivery caught", plus the "Misdelivery caught" entries of request 3 for M1 | Partly: the tab works, the request flow does not write entries yet (T04) |
| Show the metric results from the README | FHIR validation, effort, misdeliveries, and audit coverage | Partly: `pnpm scenario` (T17, T18) runs and writes the table to `out/metrics/metrics.md`, but reports the flow steps as blocked. The stopwatch test (T19) is not done. |

Say, filled in from the frozen build and the README status: "What works: …. Not built yet: …. Simulated: ID Austria with Keycloak and without the phone-app confirmation, the eHVD with our mock, email in Mailpit, and SMS on our SMS screen."

## Scene 10: disclaimer (8 s)

Show the disclaimer from [Compliance and safety](COMPLIANCE_AND_SAFETY.md#disclaimer) as a closing card, with the repository link. The video must show it.

## If the time runs short

Cut in this order and say in the video what was cut:

1. The Matrix notice in scene 3. The M1 notice in scene 8 shows the same kind of notice.
2. The HAPI view in scene 6. The Matrix notice alone shows the filing.
3. Shorten scene 7 to the SMS screen and the filed notice. Keep request 2 in the video, because the track judges the flow on both requests.

## If the flow is not ready at the freeze

Record only what is Ready, and say plainly what is not built. A possible order:

1. Dr. Hofer's room, the widget, and the request form with its input check. Its message "Sending from the widget is not connected yet." is honest on screen.
2. `!status` in the room, with the checks of the database, the FHIR server, and Matrix.
3. The tests for M1, M2, and M3 in `pnpm test`: the login checks in `src/server/identity/login.test.ts` and the patient check in `src/server/documents/patient-check.test.ts`.
4. The eHVD mock at http://localhost:8095/healthz.
5. The output of `pnpm scenario`: which steps pass and which are blocked, and why.
6. The design in one sentence per step, then scene 9 with the list of what is not built, and scene 10.
