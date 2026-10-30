# ordy UI prototype

Clickable design prototype for ordy, built with Vite, React and shadcn/ui. It runs the whole request flow in the browser with synthetic data: request service, simulated ID Austria, mock eHVD, email and SMS, FHIR mapper, and audit log (`src/lib/engine.ts`).

It is a design reference only. The real application is the Next.js app in the repository root, and [docs/](../../docs/) is the source of truth. The dashboard and the metrics page are now views of the ordy widget, Overview and Metrics ([Architecture](../../docs/ARCHITECTURE.md#widget)). The recipient's inbox is the demo page `/inbox` outside the widget, because the simulated ID Austria login refuses to load in another site's frame (`X-Frame-Options: SAMEORIGIN`), so an answer link cannot open inside Element's iframe.

The app leaves out these parts of the prototype:

| Prototype feature | Why the app leaves it out |
|---|---|
| Admin view and the role switch between doctor and admin | ordy has no role model, and a switch that looks like access control without being one would mislead. Audit log and Metrics are open to every network member, as `clinic.audit` already is. |
| Theme switch | The widget should follow Element's theme through the widget URL instead, and only `pnpm matrix:bootstrap` writes that URL. Not built yet. |
| Reset demo data dialog | It would delete Postgres, HAPI, and Mailpit data from a clinic screen. That stays the command `pnpm reset`. |
| Organisation suggestions in New request | The installed Base UI combobox clears free text when the field loses focus. |
| "Structure errors" count per filed Bundle | Validation is a batch run, `pnpm validate`. The Metrics view shows its last result. |
| "Forward to a colleague" in the inbox | It would fake an email ordy never sent. For M2, open the same link again and log in as `thomas.wagner`. |
| Unread badge on the inbox card | The card links out of the widget, and a count would need a clinic procedure that reads Mailpit. |
| Portal pages for filed, expired, locked, and not-yet-sent links | Every link that does not work shows the same page, so a link holder learns nothing about the request ([Link rules](../../docs/ARCHITECTURE.md#link-rules)). |
| In-page ID Austria simulation and "Create a test person" | The real login through Keycloak replaces it. ID Austria has no sign-up page, and `pnpm citizen` adds test people. |
| Test file buttons, "Copy from the file", and "Patient in file" on the portal | They would put the scenario files into the portal and turn the typed patient confirmation, the second input of the M3 check, into one click. |
| A request description on the portal | The request has no such field. A free-text field needs a migration and a compliance review. |
| "It took you 1:23" after sending | The sender gains nothing from it. The timed test uses the observer's stopwatch and `pnpm audit:check --effort`. |

```bash
npm install --before=<date 7 days ago>   # keeps the team's 7-day rule for new packages
npm run dev                              # http://localhost:5173
npm run build                            # single file in dist/index.html, opens without a server
```

Prototype with synthetic data. ID Austria is simulated. Not for clinical use.
