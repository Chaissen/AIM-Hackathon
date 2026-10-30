# Demo script (draft)

A draft click path for the 2-minute video and the live demo, written for the pitch team. Doc 2 owns the final script and the video (T21). The track asks the video to say what works and what does not, so scene 9 does that.

The steps follow the documented target behaviour in [Architecture](ARCHITECTURE.md) and [Identity and misdelivery](IDENTITY.md). The screen texts are the ones in the code where they exist. Each step has a state:

- **Ready**: works on `main` today.
- **Partly**: some of it is built (the row says what), but the step cannot be shown as written yet.
- **Not built**: waits for the tasks named. [Timeline](TIMELINE.md) has the owners.

States as of 30 October 2026, 02:30, with the request core (T04), the ID Austria login (T07), the FHIR mappers (T12, T14), the filing (T13), the metric runner (T17, T18), and the AI fallback parser (T22) on `main`. Check them again on the frozen build before recording. Cut every step that is still not built, or replace it with one spoken sentence. If you show a screen from `prototype/ordy-app`, label it on screen as a design mock-up, not the running app.

The landing page, the login, the identity checks, and the answer page work on `main`, but there is no link to open yet: the widget does not send the request (T05), and no email or SMS goes out (T06). Those steps say "needs a link". The pages for a refused, held, or failed login are not built yet (T09), so on `main` such a login ends on a 404 page.

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

1. Record on the frozen build. Run `pnpm reset`, then `pnpm dev`. Do not run `pnpm test` after the reset: its request tests move the request ids on.
2. `pnpm reset` keeps the Matrix room and the notices from rehearsals. For a clean room, set a new `MATRIX_ROOM_ALIAS` in `.env`, run `pnpm matrix:bootstrap`, restart `pnpm dev`, and leave the old room in Element.
3. Open these tabs: Element at http://localhost:8081 logged in as `lena.hofer` / `hofer-demo-2026` with the room "Dr. Hofer · Outside documents" and the ordy widget open, Mailpit at http://localhost:8025, the SMS screen at http://localhost:3010/sms, and HAPI FHIR's web UI at http://localhost:8090. The base URL http://localhost:8090/fhir alone shows only an error, so use the search links in scenes 6 and 7.
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
| In the widget, pick **Lab result**, patient Maria Beispiel, Eva Brandl, Labor Kanalstraße, `eva.brandl@labor-kanal.example`, then **Send request** | The form, then the notice "Request 1 sent to Dr. Eva Brandl (Labor Kanalstraße) by email." in the room | Partly: the form and the request core (T04) work, but the widget does not call the request core yet (T05), and no email goes out (T06) |
| Open the email in Mailpit | "Secure request from Klinikum Beispielstadt", the link, the expiry date. No patient name, no birth date, no document type. | Not built (T06) |

Say: The email names only Dr. Hofer and the clinic. Nobody who intercepts it learns about the patient.

## Scene 3: M2, forwarded link (10 s)

| Click | What you see | State |
|---|---|---|
| In a private window, open the link from the email | "Dr. Lena Hofer at Klinikum Beispielstadt sent you a request" and **Log in with ID Austria**. Nothing about the patient. | Partly: built (T04), needs a link (T05, T06) |
| Log in as `thomas.wagner` / `demo-thomas`, Dr. Brandl's colleague | "This request is for someone else. Nothing was shared with you." | Partly: the login and the check are built (T07, T08), but the refusal page is not (T09), so on `main` this login ends on a 404 page. Needs a link (T05, T06). |
| Switch to Element and open the thread of request 1 | "Request 1 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Thomas Wagner). Nothing was shown or filed. Check the address." | Partly: the login posts it (T07), needs a link (T05, T06). Until the widget sends the request, the notice is a new message in the room, not in a thread. |

Say: A forwarded link is useless. Only the person Dr. Hofer named can open it.

## Scene 4: Dr. Brandl logs in (8 s)

| Click | What you see | State |
|---|---|---|
| Close the private window, open the same link in a new one, and click **Log in with ID Austria** | The Keycloak login titled "ID Austria (Simulation)" | Partly: built (T07), needs a link (T05, T06) |
| Log in as `eva.brandl` / `demo-eva` | The answer page: "Lab result for Maria Beispiel, born 12 March 1961", an upload field, and fields for the patient's name and birth date | Partly: built (T04, T07), needs a link (T05, T06) |

Say: No account with us and nothing new to install: she logs in with her ID Austria, simulated here without the phone-app step.

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
| Switch to Element and open the thread of request 1 | "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range." | Partly: the notice text, the lab mapper, and the filing Bundle are built (T12, T13), the upload and the release check are not (T09, T15) |
| Open http://localhost:8090/fhir/DiagnosticReport?subject=Patient/maria-beispiel&_include=DiagnosticReport:result&_revinclude=Provenance:target&_pretty=true | One DiagnosticReport with four Observations and their LOINC codes (INR, aPTT, platelets, fibrinogen), and a Provenance that holds the ID Austria token | Partly: the lab mapper and the filing Bundle with Provenance and Task are built (T12, T13), but nothing calls them until the upload exists (T09) |

Say: Dr. Hofer gets structured values she can trend and reuse, not a scan, and the Provenance proves who sent them.

## Scene 7: request 2, rehab report by SMS (14 s)

| Click | What you see | State |
|---|---|---|
| In the widget, pick **Rehab discharge report**, Stefan Kern, Reha Waldblick, `+43 660 000 0101`, send | The form switches to SMS. The notice "Request 2 sent to Stefan Kern (Reha Waldblick) by SMS." | Partly: the form and the request core (T04) work, but the widget does not call the request core yet (T05), and no SMS goes out (T06) |
| Open the SMS screen and the link in it | The SMS on a phone frame, then the landing page | Partly: the SMS screen exists, the SMS log is not built (T06) |
| Log in as `stefan.kern` / `demo-stefan`, upload `rehab-report-maria-beispiel.md`, enter Maria Beispiel and 12 March 1961, send | The answer page, then a confirmation | Partly: the login and the answer page are built (T07), the upload is not (T09), and it needs a link (T05, T06) |
| Switch to Element and open the thread of request 2 | "Rehab discharge report for Maria Beispiel from Stefan Kern is filed. Identity checked with ID Austria." | Partly: the notice text, the rehab mapper, and the filing Bundle are built (T13, T14), the upload and the release check are not (T09, T15) |
| Open http://localhost:8090/fhir/DocumentReference?subject=Patient/maria-beispiel&_revinclude=Provenance:target&_pretty=true | A DocumentReference with the report attached, and its Provenance | Partly: the rehab mapper and the filing Bundle are built (T13, T14), but nothing calls them until the upload exists (T09) |

Say: Stefan Kern only sends the report. The Provenance names Dr. Leitner, who wrote it, as author and Stefan Kern as informant.

## Scene 8: M1, mistyped address (10 s)

| Click | What you see | State |
|---|---|---|
| In the widget, send the lab request again to `eva.brandl@labor-kanaI.example`, with a capital I | The warning "The address domain `labor-kanaI.example` does not match Labor Kanalstraße (`labor-kanal.example`)." next to **Send anyway** and **Cancel** | Not built (T05, T15) |
| Click **Send anyway**. Off camera, open the new email in Mailpit and its link in a fresh private window. | Only the requesting doctor and clinic | Partly: the request core can send anyway (T04), the button and the email are not built (T05, T06) |
| Log in as `anna.huber` / `demo-anna`, who owns the mistyped address | "This request is for someone else. Nothing was shared with you." | Partly: the login and the check are built (T07, T08), but the refusal page is not (T09), so on `main` this login ends on a 404 page. Needs a link (T05, T06). |
| Switch to Element and open the thread of request 3 | "Request 3 was opened by someone who is not Dr. Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address." | Partly: the login posts it (T07), needs a link (T05, T06) |

Say: ordy warns before sending, and even if Dr. Hofer sends anyway, the stranger sees nothing.

## Scene 9: audit log, metrics, and limits (28 s)

| Click | What you see | State |
|---|---|---|
| Open the **Audit log** tab in the widget and scroll: it lists every audit entry, newest first, with its request | At the top, request 3's entries for M1, with "Identity checked" and outcome `fail` and the "Misdelivery caught" entries. Further down, request 1's six event types, from "Answer filed" at the top to "Request sent" at the bottom: "Answer filed", "Answer sent", "Misdelivery caught", "Identity checked", "Link opened", and "Request sent" | Partly: the tab shows what the request core and the login write (T04, T07). "Answer sent" and "Answer filed" wait for the upload (T09). |
| Show the metric results from the README | FHIR validation, effort, misdeliveries, and audit coverage | Partly: `pnpm scenario` (T17, T18) runs and writes the table to `out/metrics/metrics.md`, but reports the flow steps as blocked. The stopwatch test (T19) is not done. |

Say, filled in from the frozen build and the README status, in about 17 s: "Works today: …. Built but not connected: …. Not built: …."

As of 02:30 that would be: "Works today: the stack, the widget and its audit log, the request core, and the ID Austria login, whose checks stop a wrong person. Built but not connected: parser, patient check, FHIR mapping and filing, AI fallback. Not built: sending, upload, eHVD checks."

## Scene 10: disclaimer (8 s)

Show the disclaimer from [Compliance and safety](COMPLIANCE_AND_SAFETY.md#disclaimer) as a closing card, with the repository link. The video must show it.

Say: ID Austria, the eHVD, email, and SMS are simulated. Real ID Austria also asks for a confirmation in the phone app.

## If the time runs short

Cut in this order and say in the video what was cut:

1. The Matrix notice in scene 3. The M1 notice in scene 8 shows the same kind of notice.
2. The Matrix notice in scene 6. The filed notice in scene 7 shows that Dr. Hofer is told, and the HAPI view shows the filing.
3. Shorten scene 7 to the SMS screen and the filed notice. Keep request 2 in the video, because the track judges the flow on both requests.

Never cut the HAPI view in scene 6. It is the only place the video shows the FHIR resources and the Provenance.

## If the flow is not ready at the freeze

Record only what is Ready, and say plainly what is not built. A possible order, with seconds that add up to 2:00:

1. Dr. Hofer's room, the widget, and the request form with its input check (15 s). Its message "Sending from the widget is not connected yet." is honest on screen.
2. `!status` in the room, with the checks of the database, the FHIR server, and Matrix (8 s).
3. The tests for M1, M2, and M3, the FHIR mappers, the filing Bundle with Provenance and Task, and the AI fallback (25 s). Run only these files, because the full `pnpm test` output scrolls by too fast: `pnpm exec tsx --test src/server/identity/login.test.ts src/server/documents/patient-check.test.ts src/server/fhir/mappers.test.ts src/server/fhir/filing.test.ts src/server/documents/fallback.test.ts`. They need no running services.
4. The eHVD mock (7 s): http://localhost:8095/healthz, or a `GetGDA` call for Dr. Brandl as in [eHVD](EHVD.md#getgda-look-up-one-entry-by-id).
5. The output of `pnpm scenario`: which steps pass and which are blocked, and why (15 s).
6. The design in one sentence per step, over the README architecture diagram (20 s), then the spoken part of scene 9 (22 s), and scene 10 (8 s).

Optional, if a developer can create request 1 off camera through `request.create` while `pnpm dev` runs, which prints the link: record about 35 s of the live portal instead of step 3 and 10 s of step 6. Show the landing page, `thomas.wagner`'s login up to the Keycloak page (cut before the 404 page), the notice in the room and the `fail` and "Misdelivery caught" entries in the audit tab, then `eva.brandl`'s login and the answer page.
