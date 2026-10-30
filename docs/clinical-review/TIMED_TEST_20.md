# Timed test with someone new (#20, T19)

This protocol is for the person who runs the test. The tester never reads it.

The test measures the effort metric from the [whitepaper](../WHITEPAPER.md#how-we-measure-the-metrics): someone who has never seen ordy answers request 1 with **0 installs, 0 accounts, and in under 2 minutes**. A stopwatch runs from opening the email to pressing send. The audit log backs up the stopwatch.

Plan 15 minutes per tester: 5 to prepare, 2 to brief, at most 5 for the task, 3 to fetch the audit times and fill in the table.

## Roles

| Role | Does |
|---|---|
| Operator | Prepares the stack, sends request 1 as Dr. Hofer, reads the script, runs the stopwatch, fetches the audit times |
| Observer | Sits behind the tester, notes every hesitation with the stopwatch time and the screen. Never speaks during the task. |

One person can do both, but a separate observer catches more.

## Recruit the tester

- Someone who has never seen ordy: not on the team, has not watched the demo or the video, and has not read the repository or the slides.
- Ideally someone who works in healthcare or uses email and a browser at work every day. Note the profile, not the name.
- They must be able to read English, because the email and the portal are in English.
- Tell them only: "We are testing how long a task takes in our software. We test the software, not you." Do not say what the task is, what ordy does, or that a login is involved.
- Testers 2 and 3 must not watch tester 1.
- The tester plays Dr. Eva Brandl with a made-up ID Austria login. Nothing about the tester goes into the system, and the result table names only the profile, such as "medical student, final year".

## Prepare (before the tester arrives)

1. **Stack.** On the computer the tester will use, start the stack as [Development](../DEVELOPMENT.md#start) describes: the containers are up (`./scripts/setup.sh` once) and `pnpm dev` runs. http://localhost:3010 shows three green dots. Use this same computer for the test: the link points to `localhost:3010` and the login to Keycloak on `localhost:8080`, so a second device would need `PUBLIC_URL` and the Keycloak address changed, which this protocol does not cover.
2. **Email.** For the test, email goes to the team's Gmail inbox, as [Development](../DEVELOPMENT.md) ("Send email through Gmail", from #47) describes: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, and `MAIL_TEAM_INBOXES` in `.env`, and the inbox the tester will see is in `MAIL_TEAM_INBOXES`. Restart `pnpm dev` after changing `.env`. Without Gmail, use Mailpit at http://localhost:8025 and note "Mailpit" in the result table.
3. **Clean slate.** Run `pnpm reset`. It empties Postgres, HAPI, and Mailpit and reloads Maria Beispiel. Then restart `pnpm dev`.
4. **Rehearse once yourself.** Do steps 6 to 8 and answer the request as the tester would, then run `pnpm audit:check --effort` and check that it prints an effort. Then run `pnpm reset` again and delete the rehearsal email from the inbox. If Gmail warns about the link or hides it, note it: the tester will see the same.
5. **The tester's screen.** Open a browser window with the team inbox. Close every other tab, especially Element, the widget, Mailpit, and the docs. Use a browser profile that is logged in to Gmail and nothing else of ours.
6. **The document.** Copy `track/scenario/documents/lab-result-maria-beispiel.md` to the desktop of this computer under the same name. It stands for the report that Dr. Brandl's lab system produced.
7. **The login card.** Write on a card: "Your ID Austria login: username `eva.brandl`, password `demo-eva`". Real ID Austria would use the phone app. The card is the only stand-in for it.
8. **Send request 1.** Log in to Element as `lena.hofer` / `hofer-demo-2026` in another browser profile or on another computer, open the ordy widget in "Dr. Hofer · Outside documents", and send request 1 with the fields from [Architecture](../ARCHITECTURE.md#widget): `lab-result`, Maria Beispiel, Eva, Brandl, Labor Kanalstraße, `eva.brandl@labor-kanal.example`. Close Element on the tester's screen. Check that the email is in the inbox, unread, and that it is the only ordy email there.
9. **Stopwatch.** A phone stopwatch with lap times, at zero.

## Read this aloud

Read it word for word. Do not add anything, do not point at the screen, and do not mention a link, a login, an upload, a patient, or ordy.

> Thank you for helping us. For the next few minutes you are Dr. Eva Brandl, a lab physician at Labor Kanalstraße.
>
> This is your email inbox. This file on the desktop is a report that your lab system produced. This card has your ID Austria login.
>
> A doctor at a clinic has contacted you by email. Please handle it the way you would at work. I am timing it.
>
> I cannot answer questions while you work, so do what you would do if you were alone. Say "done" when you think you are finished.
>
> Go ahead whenever you are ready.

If the tester asks something during the task, answer only: "Do what you would do if you were alone." Note the question. Never help, even when they are stuck. Stop the test at 5:00 on the stopwatch and record "not finished".

## Stopwatch

| Point | When exactly |
|---|---|
| **Start** | The tester clicks the email in the inbox to open it. Not when you finish the script. |
| **Lap** | Each time the tester presses **Send securely**. |
| **Stop** | The press of **Send securely** after which the page says the answer was filed. If an earlier send was refused, for example because a name or birth date did not match, keep the stopwatch running. The time is the lap of the send that was filed. |

The audit times run from the `link_opened` entry, which the server writes when the link opens, to the `answer_sent` of the upload that was filed. So the stopwatch should be a few seconds longer: reading the email and clicking the link happen before `link_opened`. Both audit times come from the Postgres clock, so the audit side compares no two clocks.

## What the observer notes

Write one row for each hesitation, with the stopwatch time. A hesitation is any of:

- a pause of 3 seconds or more without input
- a click or a tap that leads nowhere or has to be undone, such as a wrong button or scrolling back
- a question, a sigh, or a remark aloud ("where do I…", "what is this")
- going back to an earlier page, reopening the email, or rereading the card
- an error message, such as a refused upload or a date in the wrong format

Name the screen: **Inbox**, **Email**, **Landing** (the ordy page with **Log in with ID Austria**), **ID Austria login** (the Keycloak page), **Answer** (patient, document type, upload, name and birth date), **Refused upload** (the message about a different patient), **Done** (the page after a filed answer), or **Other** (anything else, with what it showed).

Also note anything the tester installed or any account they had to create. Logging in with the ID Austria card counts as an existing state ID, not an account with us. The Gmail inbox counts as the tester's own work email.

## Pass criteria

A tester passes when all of these hold:

| Criterion | Pass |
|---|---|
| Installs | 0: no app, extension, plug-in, or certificate |
| Accounts | 0: no sign-up, no new password, no account with ordy or the clinic |
| Stopwatch | under 120 s, in whole seconds (119.6 s rounds to 120 s and misses) |
| Audit effort | under 120 s, as `pnpm audit:check --effort` rounds it |
| Filed | the request has an `answer_filed` entry |

If the answer is held for Dr. Hofer instead of filed (the release check could not confirm the role), click **Accept** in the widget after the stopwatch stopped. `answer_filed` is then written, and the audit effort still ends at the tester's send. Note "held, accepted" in the table.

## Fetch the audit times

Right after the tester says "done", before anyone sends another request 1 or runs `pnpm scenario`:

```bash
pnpm audit:check --effort
```

It picks the newest `lab-result` request to `eva.brandl@labor-kanal.example` and prints its audit entries with the seconds since the `link_opened` that starts the clock, marks the start and the stop, and prints the effort, for example:

```
Request 1: seconds since the link_opened that starts the clock
  2026-10-31T09:12:40.002Z    -82.1 s  request_sent        sent              network_member
  2026-10-31T09:14:02.118Z      0.0 s  link_opened         shown             anonymous  <- start
  2026-10-31T09:14:31.540Z     29.4 s  identity_checked    pass              outside_person
  2026-10-31T09:15:20.907Z     78.8 s  answer_sent         received          outside_person  <- stop
  2026-10-31T09:15:22.311Z     80.2 s  answer_filed        filed             service
Effort: 79 s (78.8 s) from link_opened to the answer_sent that was filed.

Target under 2 minutes: met.
```

`request_sent` shows a negative offset, because it was written before the link opened. With `--request <id>` it reads another request, for example when someone sent another request 1 in between. It exits with 0 only when the effort is under 2 minutes. The offsets help place the observer's notes: the stopwatch time of a note minus the difference below is roughly its audit offset.

Then fill in the table:

- **Difference** = stopwatch − audit effort, in seconds. Expect 0 to 15 s: the time for opening the email and clicking the link.
- A negative difference or one over 30 s means the stopwatch started late or stopped at the wrong send, or the helper read the wrong request. Check the request id and the laps, and note what you found.

If the helper prints "Effort: not measured", the request has no `answer_filed`. Check the request's state in the widget.

## Between testers

1. Fill in the tester's table and hesitations below.
2. Delete the email from the inbox and close every ordy tab.
3. `pnpm reset`, restart `pnpm dev`, and send request 1 again (Prepare, step 8). The document on the desktop stays.

## Results

Fill in by hand, commit the file, and copy the summary into the README's metric table (T20). No tester names.

### Tester 1

| Field | Value |
|---|---|
| Date and time | |
| Operator, observer | |
| Tester profile | |
| Device and browser | |
| Inbox | Gmail / Mailpit |
| Request id | |
| Stopwatch (s) | |
| Laps (s) | |
| Audit effort (s) | |
| Difference (s) | |
| Hesitations | |
| Installs | |
| Accounts | |
| Filed | yes / held, accepted / no |
| Pass or fail | |

| Stopwatch | Screen | What happened |
|---|---|---|
| | | |
| | | |
| | | |

### Tester 2

| Field | Value |
|---|---|
| Date and time | |
| Operator, observer | |
| Tester profile | |
| Device and browser | |
| Inbox | Gmail / Mailpit |
| Request id | |
| Stopwatch (s) | |
| Laps (s) | |
| Audit effort (s) | |
| Difference (s) | |
| Hesitations | |
| Installs | |
| Accounts | |
| Filed | yes / held, accepted / no |
| Pass or fail | |

| Stopwatch | Screen | What happened |
|---|---|---|
| | | |
| | | |
| | | |

### Tester 3

| Field | Value |
|---|---|
| Date and time | |
| Operator, observer | |
| Tester profile | |
| Device and browser | |
| Inbox | Gmail / Mailpit |
| Request id | |
| Stopwatch (s) | |
| Laps (s) | |
| Audit effort (s) | |
| Difference (s) | |
| Hesitations | |
| Installs | |
| Accounts | |
| Filed | yes / held, accepted / no |
| Pass or fail | |

| Stopwatch | Screen | What happened |
|---|---|---|
| | | |
| | | |
| | | |

### Summary

| Tester | Profile | Stopwatch (s) | Audit effort (s) | Difference (s) | Hesitations | Installs | Accounts | Pass |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |

Where testers hesitated, and what we changed because of it:

-

## Readiness on 30 October 2026

Checked from the code on `main` at `db9fe63`, without a running stack. Check again when #13 lands, with the rehearsal in Prepare, step 4.

| Step | Today |
|---|---|
| Send request 1 from the widget | Works (#32). The request is created and `request_sent` written, but no email goes out: `request.create` only prints the link to the `[web]` log in development. |
| Email in the Gmail inbox | Missing. #47 (open) adds `sendRequestEmail()` and the Gmail settings, but nothing calls it yet. `request.create` has to call it where it prints the link today. The Gmail app password of the team account is needed in `.env`. |
| Landing page `/r/{token}`, `link_opened` | Works. |
| ID Austria login and identity checks | Work (#42, #34). A pass sends the tester to the answer page. |
| Answer page with patient and document type | Works. The upload field and the name and birth date fields are there. |
| **Send securely** | Missing (#13). The button only says "Uploading is not connected yet", so no `answer_sent` and no `answer_filed` are written. |
| Refused upload, held, refused, and unavailable pages, Done page | Missing on `main`. `feat/T09-portal-flow` (#13) has them. |
| Release check at filing | #44 (open). Without it, how #13 files or holds the answer decides whether the request reaches `answer_filed` without **Accept**. |
| `pnpm audit:check --effort` | Works, with tests. Measures nothing until #13 writes `answer_sent` and `answer_filed`. |
