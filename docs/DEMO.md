# Demo script (draft)

A draft click path for the 2-minute video and the live demo, written for the pitch team. The pitch team owns the final script and the video. The track asks the video to say what works and what does not, so scene 9 does that.

The steps follow the documented target behaviour in [Architecture](ARCHITECTURE.md) and [Identity and misdelivery](IDENTITY.md). The screen texts are the ones in the code where they exist. Each step has a state:

- **Ready**: works on `main` today.
- **Partly**: some of it is built (the row says what), but the step cannot be shown as written yet.
- **Not built**: no code on `main` does it yet. [Timeline](TIMELINE.md) has the tasks and owners.

States as of 30 October 2026, 03:20, on `main` at commit `06abdc9`, checked in one run by hand through request 1, M1 to M3, and the rehab request. #4 then connected the email: the email steps below are marked from a check through the router (`request.create` and `sendAnyway` with Mailpit), not from a new run by hand. Check them again on the frozen build before recording. Cut every step that is still not built, or replace it with one spoken sentence. If you show a screen from `prototype/ordy-app`, label it on screen as a design mock-up, not the running app.

ordy sends the request email to Mailpit and puts the SMS on the SMS screen at http://localhost:3010/sms. No real phone gets it.

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

1. Record on the frozen build. If upgrading an installation that served Element on 8081, follow the [gateway migration](DEPLOYMENT.md#migrate-an-existing-element-entry) first. Run `pnpm reset`, then `pnpm dev`. Do not run `pnpm test` or `pnpm demo:seed` after the reset: the request tests move the request ids on, and the [demo seed](#a-populated-workspace) fills the workspace that the recording starts empty. If a login returns to the landing page with `?login=failed`, read the `pnpm dev` log. If it says "A private ORDY_SECRET … is required", run `pnpm exec tsx scripts/init-env.ts` and restart `pnpm dev`.
2. `pnpm reset` keeps the Matrix room and the notices from rehearsals. For a clean room, set a new `MATRIX_ROOM_ALIAS` in `.env`, run `pnpm matrix:bootstrap`, restart `pnpm dev`, and select the new room in the workspace's **Messages** view. Room administration is outside the workspace; use Element Web on port 8082 if needed.
3. Open these tabs: the ordy workspace at http://localhost:8081 logged in as `lena.hofer` / `hofer-demo-2026`, with "Dr. Hofer · Outside documents" selected in **Messages**, Mailpit at http://localhost:8025, the SMS screen at http://localhost:3010/sms, the recipient's inbox at http://localhost:3010/inbox, and HAPI FHIR's web UI at http://localhost:8090. The inbox shows Mailpit's emails and the SMS screen on one page, with an **Open as recipient** button for each email's link, and the workspace's **Demo tools** card opens it. It is not in a production build. The base URL http://localhost:8090/fhir alone shows only an error, so use the search links in scenes 6 and 7.
4. Every notice is a new message in the room until the "request sent" notice exists. Tests and rehearsals post into the same room, so use a clean room (step 2).
5. Private windows of one browser share their cookies. Close every private window before you switch to the next outside person, or use a separate browser profile for each person.
6. Keep the files ready: `track/scenario/documents/lab-result-maria-beispiel.md`, `lab-result-max-beispiel.md`, and `rehab-report-maria-beispiel.md`.
7. Fill forms off camera or speed up typing in the edit. Two minutes leave no time for typing.
8. Show only synthetic data. No real names, addresses, or phone numbers on screen, including browser history and bookmarks.

## Scene 1: the problem (6 s)

| Click | What you see | State |
|---|---|---|
| Show the ordy workspace and open **Messages** | The room "Dr. Hofer · Outside documents" in ordy's design, alongside the clinical navigation | Ready |

Say: Outside labs still answer by fax. ordy gives Dr. Hofer one workspace for requests and Matrix messages.

## Scene 2: request 1, lab result by email (16 s)

| Click | What you see | State |
|---|---|---|
| In the workspace, open **New request** and pick **Lab result**, patient Maria Beispiel, Eva Brandl, Labor Kanalstraße, `eva.brandl@labor-kanal.example`, then **Send request** | The form, then the notice "Request 1 sent to Dr. Eva Brandl (Labor Kanalstraße) by email." in the room | Partly: the workspace sends the request and shows request 1 below the form with the state "Sent". The room notice is not built. |
| Open the email in Mailpit | "Secure request from Klinikum Beispielstadt", the link, the expiry date. No patient name, no birth date, no document type. | Ready (#4). It names Dr. Hofer by her Matrix display name, which `pnpm matrix:bootstrap` sets to "Dr. Lena Hofer". |

Say: The email names only Dr. Hofer and the clinic, never the patient.

## Scene 3: M2, forwarded link (10 s)

| Click | What you see | State |
|---|---|---|
| In a private window, open the link from the email | "Dr. Lena Hofer at Klinikum Beispielstadt sent you a request" and **Log in with ID Austria**. Nothing about the patient. | Ready |
| Log in as `thomas.wagner` / `demo-thomas`, Dr. Brandl's colleague | "This request is for someone else. Nothing was shared with you." | Ready |
| Open **Messages** in the workspace and look at the newest message in the room | "Request 1 was opened by someone who is not Eva Brandl (ID Austria name: Thomas Wagner). Nothing was shown or filed. Check the address." | Ready, as a new message, not in a thread. The workspace's **Requests** view shows the same catch on request 1: "Identity checked" with `fail` and "Misdelivery caught" with `wrong_person`. |

Say: A forwarded link is useless. Only the person Dr. Hofer named can open it.

## Scene 4: Dr. Brandl logs in (8 s)

| Click | What you see | State |
|---|---|---|
| Close the private window, open the same link in a new one, and click **Log in with ID Austria** | The Keycloak login titled "ID Austria (Simulation)" | Ready |
| Log in as `eva.brandl` / `demo-eva` | The answer page: "Lab result for Maria Beispiel, born 12 March 1961", an upload field, and fields for the patient's name and birth date | Ready |

Say: No account with us and nothing new to install: she logs in with her ID Austria, simulated here without the phone-app step.

## Scene 5: M3, wrong patient (8 s)

| Click | What you see | State |
|---|---|---|
| Upload `lab-result-max-beispiel.md`, enter Maria Beispiel and 12 March 1961 in the form, send | "This document is about a different patient. Check the file and upload again." | Ready |
| Open **Messages** in the workspace and look at the newest message | "The answer to request 1 is about a different patient. Name and birth date do not match Maria Beispiel. Nothing was filed." | Ready |

Say: She entered Maria's details, but the file is about Max Beispiel. The notice never names him, and the upload is discarded.

## Scene 6: the right answer is filed (12 s)

| Click | What you see | State |
|---|---|---|
| Upload `lab-result-maria-beispiel.md`, enter Maria Beispiel and 12 March 1961, send | "Thank you, your document is filed. Klinikum Beispielstadt has it now. You can close this page." | Ready |
| Open **Messages** in the workspace and look at the newest message | "Lab result for Maria Beispiel from Dr. Eva Brandl is filed. Identity checked with ID Austria. 4 values, all within the reference range." | Ready |
| Open http://localhost:8090/fhir/DiagnosticReport?subject=Patient/maria-beispiel&_include=DiagnosticReport:result&_revinclude=Provenance:target&_pretty=true | One DiagnosticReport with four Observations and their LOINC codes (INR, aPTT, platelets, fibrinogen), and a Provenance that holds the ID Austria token | Ready |

Say: Dr. Hofer gets structured values she can trend and reuse, not a scan, and the Provenance proves who sent them.

## Scene 7: request 2, rehab report by SMS (14 s)

| Click | What you see | State |
|---|---|---|
| In the workspace, open **New request** and pick **Rehab discharge report**, Stefan Kern, Reha Waldblick, `+43 660 000 0101`, send | The form switches to SMS. The notice "Request 2 sent to Stefan Kern (Reha Waldblick) by SMS." | Partly: the form switches to SMS and sends the request. The room notice is not built. |
| Open the SMS screen and the link in it | The SMS on a phone frame, then the landing page | Built: the SMS screen shows the SMS with its link. Check it on the frozen build. |
| Log in as `stefan.kern` / `demo-stefan`, upload `rehab-report-maria-beispiel.md`, enter Maria Beispiel and 12 March 1961, send | The answer page, then "Thank you, your document is filed" | Ready |
| Open **Messages** in the workspace and look at the newest message | "Rehab discharge report for Maria Beispiel from Stefan Kern is filed. Identity checked with ID Austria." | Ready |
| Open http://localhost:8090/fhir/DocumentReference?subject=Patient/maria-beispiel&_revinclude=Provenance:target&_pretty=true | A DocumentReference with the report attached, and its Provenance | Ready |

Say: Stefan Kern only sends the report. The Provenance names Dr. Leitner, who wrote it, as author and Stefan Kern as informant.

## Scene 8: M1, mistyped address (10 s)

| Click | What you see | State |
|---|---|---|
| In the workspace, open **New request** and send the lab request again to `eva.brandl@labor-kanaI.example`, with a capital I | The warning "The address domain `labor-kanaI.example` does not match Labor Kanalstraße (`labor-kanal.example`)." next to **Send anyway** and **Cancel** | Ready |
| Click **Send anyway**, then open the new email in Mailpit and its link in a fresh private window. | Only the requesting doctor and clinic | Ready: **Send anyway** sends the email with the new link (#4) |
| Log in as `anna.huber` / `demo-anna`, who owns the mistyped address | "This request is for someone else. Nothing was shared with you." | Ready |
| Open **Messages** in the workspace and look at the newest message | "Request 3 was opened by someone who is not Eva Brandl (ID Austria name: Anna Huber). Nothing was shown or filed. Check the address." | Ready |

Say: ordy warns before sending, and even if Dr. Hofer sends anyway, the stranger sees nothing.

## Scene 9: audit log, metrics, and limits (28 s)

| Click | What you see | State |
|---|---|---|
| Open **Audit log** in the workspace navigation and scroll: it lists every audit entry, newest first, with its request | At the top, request 3's entries for M1, with "Identity checked" and outcome `fail` and the "Misdelivery caught" entries. Further down, request 1's six event types, from "Answer filed" at the top to "Request sent" at the bottom: "Answer filed", "Answer sent", "Misdelivery caught", "Identity checked", "Link opened", and "Request sent" | Ready |
| Show the metric results from the README | FHIR validation, effort, misdeliveries, and audit coverage | Ready for three metrics, from the run by hand. Effort waits for the stopwatch test. Do not show `pnpm scenario`: it still reports its steps as blocked. |
| Or open **Metrics** in the workspace navigation | The four metrics with their sources, the tests M1 to M3, and the last `pnpm validate` and `pnpm scenario` results | Ready. It does not run the page check or the Matrix notice check, so `pnpm scenario` stays the measurement of record. |

Say, filled in from the frozen build and the README status, in about 17 s: "Works today: …. Built but not connected: …. Not built: …."

With #4 that would be: "Works today: both requests and all three misdeliveries, with the request email, FHIR filing, Provenance, and the audit log. Built but not connected: the AI fallback. Not built yet: the SMS."

## Scene 10: disclaimer (8 s)

Show the disclaimer from [Compliance and safety](COMPLIANCE_AND_SAFETY.md#disclaimer) as a closing card, with the repository link. The video must show it.

Say: ID Austria and the eHVD are simulated, and the SMS goes to the SMS screen instead of a phone. Real ID Austria also asks for a confirmation in the phone app.

## If the time runs short

Cut in this order and say in the video what was cut:

1. The Matrix notice in scene 3. The M1 notice in scene 8 shows the same kind of notice.
2. The Matrix notice in scene 6. The filed notice in scene 7 shows that Dr. Hofer is told, and the HAPI view shows the filing.
3. Shorten scene 7 to the SMS screen, the login, and the filed notice. Keep request 2 in the video, because the track judges the flow on both requests.

Never cut the HAPI view in scene 6. It is the only place the video shows the FHIR resources and the Provenance.

## A populated workspace

The recording starts from `pnpm reset`, with an empty workspace. To show the workspace full instead, for example at the booth or for screenshots, run `pnpm demo:seed` after `pnpm reset`. It needs the containers, not `pnpm dev`, and refuses while Dr. Hofer has requests, unless `--force` adds another set. It creates eleven requests about the three synthetic patients from `pnpm fhir:seed`, in the order below. After `pnpm reset` their ids are 1 to 11, unless tests ran in between.

| # | Patient | Asked from | State | How it got there |
|---|---|---|---|---|
| 1 | Maria Beispiel | Dr. Eva Brandl, Labor Kanalstraße, by email | filed | Request 1 with M2 and M3: `thomas.wagner` logs in and is refused, `eva.brandl` uploads `lab-result-max-beispiel.md` (`patient_mismatch`), then `lab-result-maria-beispiel.md` |
| 2 | Maria Beispiel | Stefan Kern, Reha Waldblick, by SMS | filed | Request 2: `stefan.kern` uploads `rehab-report-maria-beispiel.md`. Filed rather than waiting as in the prototype, so Stefan Kern becomes a verified sender and Maria's record has the discharge report. |
| 3 | Maria Beispiel | Eva Brandl at `eva.brandl@labor-kanaI.example` | sent | M1 after **Send anyway**: `anna.huber` logs in and is refused. One failed check. |
| 4 | Maria Beispiel | Eva Brandl at `eva.brandl@labor-kanaI.example` | awaiting_confirmation | M1 at the address warning, left for **Send anyway** or **Cancel** |
| 5 | Johann Muster | Eva Maria Brandl, Labor Kanalstraße, by email | identity_held | `eva.brandl` logs in. Her name matches "Eva Maria Brandl" only in part, so Dr. Hofer decides. |
| 6 | Maria Beispiel | Dr. Eva Brandl, by email | answer_held | `eva.brandl` uploads `scripts/fixtures/documents/lab-result-maria-beispiel-liver.md`, validated by Dr. Martin Brandl. The eHVD does not list him at Labor Kanalstraße, so the release check holds the answer. |
| 7 | Johann Muster | Karl Heinz Moser-Wallner, Reha Waldblick, by SMS | sent | Nobody has opened it |
| 8 | Petra Probst | Dr. Eva Brandl, by email | verified | `eva.brandl` logged in and has not uploaded yet |
| 9 | Maria Beispiel | Stefan Kern, by SMS | cancelled | Dr. Hofer cancels it |
| 10 | Petra Probst | Stefan Kern, by SMS | expired | Stefan Kern opens the link and does not answer. See below. |
| 11 | Johann Muster | Dr. Eva Brandl, by email | locked | `thomas.wagner`, `eva.brandl2` (another person number than the bound Eva Brandl), and `anna.huber` fail the identity check |

Everything goes through the code the widget, the portal, and the login use, so the audit log, the bindings, the held answer, the Tasks, and the filed Bundles on HAPI agree, and the notices reach Dr. Hofer's room. Dr. Hofer's steps are tRPC calls through `createCaller`. Each outside person opens the link (`link_opened`) and logs in through the route handlers of `POST /auth/login` and `GET /auth/callback`, which the script calls in its own process. Between the two, it posts the username and password to Keycloak's real login form and catches the redirect to the callback without following it. So Keycloak checks the password and signs the ID token, and the callback verifies it and runs the identity checks, as for a browser. Uploads go through `portal.answer` with the session the callback set. The seed sends no email: each request email is built and passes the content check, and nodemailer then hands it to an SMTP server inside the script instead of Mailpit, so Mailpit gets nothing. The script reads the email links from there. SMS links come from the SMS the request service stored for the SMS screen.

Two things differ from a real run:

- All requests are created within a minute, so the workspace shows them all as just sent.
- A link lasts seven days, so request 10 cannot expire on its own. The script moves that one request's `expires_at` into the past and calls `expireDueRequests`, the function every read calls. It sets the request `expired`, clears its ID token, and the Task becomes `failed`.

The login route handlers sign cookies with `ORDY_SECRET`. Without one in `.env`, the script uses a random key of its own, and the cookies never leave its process.

The script prints only request ids, states, and document types. At the end it checks the [data rules](COMPLIANCE_AND_SAFETY.md#data-we-keep) on what it stored: no closed request keeps an ID token, a held answer exists only for a request in `answer_held`, the Max Beispiel upload left only its hash in the audit log, and no audit entry holds document text. It exits with an error if one fails.

## The recorded video

The finished video is [`docs/video/ordy-product-video.mp4`](video/ordy-product-video.mp4): 1 min 59.7 s, 3840x2160, 30 fps, with text overlays and no voice. A scripted browser recorded the running app on `main` at commit `f0abc21` on 30 October 2026. It is a real run: the requests, logins, checks, and filing all happened as shown.

What differs from a plain run:

- **Addresses.** For the recording, the eHVD mock and the form examples used `.at` addresses instead of the reserved `.example` domains, and the browser displayed `klinikum-beispielstadt.at` in place of `klinikum.example` and `localhost`. All these domains are fictional here. The code on `main` keeps `.example`.
- **Added in the edit.** The browser frame and its address line, the cursor, the captions, the step indicator, the zooms, and the check panels. The two check panels show the fields that the identity, patient, and release checks compare, with the real claim names and synthetic directory values. The music and sounds are synthetic.
- **Order.** The video shows the clean flow first, so it does not follow [Order of the story](#order-of-the-story). M2 and M3 ran on a separate lab request after request 1 was filed. M1 shows only the warning on screen; the run continued with "Send anyway" and a refused login, and that notice appears in the oversight shot.

Measured on the data of this recording: `pnpm validate` found 0 errors in 18 resources. `pnpm audit:check` found 5 of 6 event types on request 1, because of the order above. The 6 of 6 in the [README](../README.md) comes from a run with M2 and M3 on request 1, see [E2E_RUN.md](E2E_RUN.md). The closing card shows the status at 14:20 CET on that day, including "AI fallback not connected" and "Not tested with a new user yet". If either changes, the card is out of date.
