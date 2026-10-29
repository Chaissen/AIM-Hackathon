import type { Bundle, Patient } from "fhir/r4";
import { Suspense } from "react";

import { fhirFetch } from "@/server/fhir/client";
import { RequestForm, type PatientOption } from "./request-form";

// Request form inside Element (organisations/ARCHITECTURE.md). Rendered in a narrow side panel.
export default function Widget() {
  return (
    <main className="mx-auto grid w-full max-w-md gap-4 px-4 py-5">
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold">Request a document</h1>
        <p className="text-sm text-muted-foreground">
          The person gets a secure link. They answer in the browser with ID Austria.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading patients …</p>}>
        <WidgetForm />
      </Suspense>
    </main>
  );
}

async function WidgetForm() {
  return <RequestForm patients={await loadPatients()} />;
}

async function loadPatients(): Promise<PatientOption[] | null> {
  try {
    const bundle = await fhirFetch<Bundle<Patient>>("Patient?_count=50&_sort=family");
    return (bundle.entry ?? []).flatMap(({ resource: p }) =>
      p?.id
        ? [{ id: p.id, name: [...(p.name?.[0]?.given ?? []), p.name?.[0]?.family].filter(Boolean).join(" "), birthDate: p.birthDate ?? null }]
        : [],
    );
  } catch {
    return null; // FHIR server not reachable; the form says so
  }
}
