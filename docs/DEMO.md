# Demo script (draft)

A draft click path for the 2-minute video and the live demo, written for the pitch team. The pitch team owns the final script and the video. The track asks the video to say what works and what does not, so scene 9 does that.

The steps follow the documented target behaviour in [Architecture](ARCHITECTURE.md) and [Identity and misdelivery](IDENTITY.md). The screen texts are the ones in the code where they exist. Each step has a state:

- **Ready**: works on `main` today.
- **Ready with the log link**: works, but the link comes from the `pnpm dev` log, because ordy does not send the email or the SMS yet.
- **Partly**: some of it is built (the row says what), but the step cannot be shown as written yet.
- **Not built**: no code on `main` does it yet. [Timeline](TIMELINE.md) has the tasks and owners.

States as of 30 October 2026, 03:20, on `main` at commit `06abdc9`, checked in one run by hand through request 1, M1 to M3, and the rehab request. Check them again on the frozen build before recording. Cut every step that is still not built, or replace it with one spoken sentence. If you show a screen from `prototype/ordy-app`, label it on screen as a design mock-up, not the running app.

ordy does not send the email or the SMS yet. The email text is built, but nothing calls it, and no task builds the SMS. Until then `pnpm dev` prints each new request's link in its log as `Request <id>: http://localhost:3010/r/<token>`. Every portal step works with that link.

Nothing posts the "Request … sent" notice yet: T05 did not build it, and no open task does. So a request has no thread in the room, and every later notice about it is the newest message in the room.

The notices name the outside person as typed in the form when someone else logs in ("not Eva Brandl"). Once the answer is filed, they take the title from the document's `Validated by` line ("from Dr. Eva Brandl"). The texts below are the ones the run by hand produced, with the request numbers of the scene order.

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

1. Record on the frozen build. Run `pnpm reset`, then `pnpm dev`. Do not run `pnpm test` after the reset: its request tests move the request ids on. Keep the `pnpm dev` terminal off camera: until the email and SMS exist, the links come from its log. If a login returns to the landing page with `?login=failed`, read the `pnpm dev` log. If it says "A private ORDY_SECRET … is required", run `pnpm exec tsx scripts/init-env.ts` and restart `pnpm dev`.
2. `pnpm reset` keeps the Matrix room and the notices from rehearsals. For a clean room, set a new `MATRIX_ROOM_ALIAS` in `.env`, run `pnpm matrix:bootstrap`, restart `pnpm dev`, and leave the old room in Element.
3. Open these tabs: Element at http://localhost:8081 logged in as `lena.hofer` / `hofer-demo-2026` with the room "Dr. Hofer · Outside documents" and the ordy widget open, and HAPI FHIR's web UI at http://localhost:8090. The base URL http://localhost:8090/fhir alone shows only an error, so use the search links in scenes 6 and 7.
4. Every notice is a new message in the room until the "request sent" notice exists. Tests and rehearsals post into the same room, so use a clean room (step 2).
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
| In the widget, pick **Lab result**, patient Maria Beispiel, Eva Brandl, Labor Kanalstraße, `eva.brandl@labor-kanal.example`, then **Send request** | The form, then the notice "Request 1 sent to Dr. Eva Brandl (Labor Kanalstraße) by email." in the room | Partly: the widget sends the request and shows request 1 below the form with the state "Sent". The room notice is not built. |
| Open the email in Mailpit | "Secure request from Klinikum Beispielstadt", the link, the expiry date. No patient name, no birth date, no document type. | Not built: the email text exists, but nothing sends it. Cut this step; the voice-over says that the email is not sent yet. |

Say: The email ordy will send names only Dr. Hofer and the clinic, never the patient. It is not sent yet, so we open its link directly.

## Scene 3: M2, forwarded link (10 s)

| Click | What you see | State |
|---|---|---|
| In a private window, open the link from the `pnpm dev` log | "Dr. Lena Hofer at Klinikum Beispielstadt sent you a request" and **Log in with ID Austria**. Nothing about the patient. | Ready with the log link |
| Log in as `thomas.wagner` / `demo-thomas`, Dr. Brandl's colleague | "This request is for someone else. Nothing was shared with you." | Ready with the log link |
| Switch to Element and look at the newest message in the room | "Request 1 was opened by someone who is not Eva Brandl (ID Austria name: Thomas Wagner). Nothing was shown or filed. Check the address." | Ready, as a new message, not in a thread. The widget's **Requests** view shows the same catch on request 1: "Identity checked" with `fail` and "Misdelivery caught" with `wrong_person`. |

Say: A forwarded link is useless. Only the person Dr. Hofer named can open it.

## Scene 4: Dr. Brandl logs in (8 s)

| Click | What you see | State |
|---|---|---|
| Close the private window, open the same link in a new one, and click **Log in with ID Austria** | The Keycloak login titled "ID Austria (Simulation)" | Ready with the log link |
| Log in as `eva.brandl` / `demo-eva` | The answer page: "Lab result for Maria Beispiel, born 12 March 1961", an upload field, and fields for the patient's name and birth date | Ready with the log link |

Say: No account with us and nothing new to install: she logs in with her ID Austria, simulated here without the phone-app step.

## Scene 5: M3, wrong patient (8 s)

| Click | What you see | State |
|---|---|---|
| Upload `lab-result-max-beispiel.md`, enter Maria Beispiel and 12 March 1961 in the form, send | "This document is about a different patient. Check the file and upload again." | Ready |
| Switch to Element and look at the newest message | "The answer to request 1 is about a different patient. Name and birth date do not match Maria Beispiel. Nothing was filed." | Ready |

Say: She entered Maria's details, but the file is about Max Beispiel. The notice never names him, and the upload is discarded.

## Scene 6: the right answer is filed (12 s)

| Click | What you see | State |
|---|---|---|
| Upload `lab-result-maria-beispiel.md`, enter Maria Beispiel and 12 March 1961, send | "Thank you, your document is filed. Klinikum Beispielstadt has it now. You can close this page." | Ready |
| Switch to Element and look at the newest message | "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range." | Ready |
| Open http://localhost:8090/fhir/DiagnosticReport?subject=Patient/maria-beispiel&_include=DiagnosticReport:result&_revinclude=Provenance:target&_pretty=true | One DiagnosticReport with four Observations and their LOINC codes (INR, aPTT, platelets, fibrinogen), and a Provenance that holds the ID Austria token | Ready |

Say: Dr. Hofer gets structured values she can trend and reuse, not a scan, and the Provenance proves who sent them.

## Scene 7: request 2, rehab report by SMS (14 s)

| Click | What you see | State |
|---|---|---|
| In the widget, pick **Rehab discharge report**, Stefan Kern, Reha Waldblick, `+43 660 000 0101`, send | The form switches to SMS. The notice "Request 2 sent to Stefan Kern (Reha Waldblick) by SMS." | Partly: the form switches to SMS and sends the request. The room notice is not built. |
| Open the SMS screen and the link in it | The SMS on a phone frame, then the landing page | Not built: the SMS screen stays empty. Open the log link instead and say that the SMS is not sent yet. |
| Log in as `stefan.kern` / `demo-stefan`, upload `rehab-report-maria-beispiel.md`, enter Maria Beispiel and 12 March 1961, send | The answer page, then "Thank you, your document is filed" | Ready with the log link |
| Switch to Element and look at the newest message | "Rehab discharge report for Maria Beispiel from Stefan Kern is filed. Identity checked with ID Austria." | Ready |
| Open http://localhost:8090/fhir/DocumentReference?subject=Patient/maria-beispiel&_revinclude=Provenance:target&_pretty=true | A DocumentReference with the report attached, and its Provenance | Ready |

Say: Stefan Kern only sends the report. The Provenance names Dr. Leitner, who wrote it, as author and Stefan Kern as informant.

## Scene 8: M1, mistyped address (10 s)

| Click | What you see | State |
|---|---|---|
| In the widget, send the lab request again to `eva.brandl@labor-kanaI.example`, with a capital I | The warning "The address domain `labor-kanaI.example` does not match Labor Kanalstraße (`labor-kanal.example`)." next to **Send anyway** and **Cancel** | Ready |
| Click **Send anyway**. Off camera, copy the new link from the `pnpm dev` log and open it in a fresh private window. | Only the requesting doctor and clinic | Ready with the log link: **Send anyway** sends the request, and `pnpm dev` prints its new link |
| Log in as `anna.huber` / `demo-anna`, who owns the mistyped address | "This request is for someone else. Nothing was shared with you." | Ready with the log link |
| Switch to Element and look at the newest message | "Request 3 was opened by someone who is not Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address." | Ready |

Say: ordy warns before sending, and even if Dr. Hofer sends anyway, the stranger sees nothing.

## Scene 9: audit log, metrics, and limits (28 s)

| Click | What you see | State |
|---|---|---|
| Open the **Audit log** tab in the widget and scroll: it lists every audit entry, newest first, with its request | At the top, request 3's entries for M1, with "Identity checked" and outcome `fail` and the "Misdelivery caught" entries. Further down, request 1's six event types, from "Answer filed" at the top to "Request sent" at the bottom: "Answer filed", "Answer sent", "Misdelivery caught", "Identity checked", "Link opened", and "Request sent" | Ready |
| Show the metric results from the README | FHIR validation, effort, misdeliveries, and audit coverage | Ready for three metrics, from the run by hand. Effort waits for the stopwatch test. Do not show `pnpm scenario`: it still reports its steps as blocked. |

Say, filled in from the frozen build and the README status, in about 17 s: "Works today: …. Built but not connected: …. Not built: …."

As of 03:20 that would be: "Works today: both requests and all three misdeliveries, with FHIR filing, Provenance, and the audit log. Built but not connected: the request email and the AI fallback. Not built yet: the SMS."

## Scene 10: disclaimer (8 s)

Show the disclaimer from [Compliance and safety](COMPLIANCE_AND_SAFETY.md#disclaimer) as a closing card, with the repository link. The video must show it.

Say: ID Austria and the eHVD are simulated. ordy does not send the email or the SMS yet. Real ID Austria also asks for a confirmation in the phone app.

## If the time runs short

Cut in this order and say in the video what was cut:

1. The Matrix notice in scene 3. The M1 notice in scene 8 shows the same kind of notice.
2. The Matrix notice in scene 6. The filed notice in scene 7 shows that Dr. Hofer is told, and the HAPI view shows the filing.
3. Shorten scene 7 to the login with the log link and the filed notice. Keep request 2 in the video, because the track judges the flow on both requests.

Never cut the HAPI view in scene 6. It is the only place the video shows the FHIR resources and the Provenance.

## If the email and SMS are still not sent at the freeze

Record the scenes above with the log link. The scene 2 voice-over already says that the email is not sent yet. Cut the Mailpit step in scene 2 and the SMS screen in scene 7, and use the freed seconds for the HAPI view in scene 6. Name the missing email and SMS again in the spoken part of scene 9.
