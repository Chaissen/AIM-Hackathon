import { SystemStatus } from "./system-status";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">ordy</h1>
      <p className="mt-2 text-foreground/70">
        Secure document requests from outside the PGK network, filed as FHIR R4.
      </p>
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-widest text-foreground/60">System status</h2>
      <SystemStatus />
    </main>
  );
}
