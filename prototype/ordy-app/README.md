# ordy UI prototype

Clickable design prototype for ordy, built with Vite, React and shadcn/ui. It runs the whole request flow in the browser with synthetic data: request service, simulated ID Austria, mock eHVD, email and SMS, FHIR mapper, and audit log (`src/lib/engine.ts`).

It is a design reference only. The real application is the Next.js app in the repository root, and [organisations/](../../organisations/) is the source of truth. Parts of this prototype, such as the dashboard, the admin view, and the metrics page, are not in the docs.

```bash
npm install --before=<date 7 days ago>   # keeps the team's 7-day rule for new packages
npm run dev                              # http://localhost:5173
npm run build                            # single file in dist/index.html, opens without a server
```

Prototype with synthetic data. ID Austria is simulated. Not for clinical use.
