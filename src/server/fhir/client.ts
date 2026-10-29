import type { CapabilityStatement, FhirResource } from "fhir/r4";

import { env } from "@/env";

export class FhirError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`FHIR request failed with ${status}`);
  }
}

export async function fhirFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.FHIR_BASE_URL}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { Accept: "application/fhir+json", "Content-Type": "application/fhir+json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new FhirError(res.status, body);
  return body as T;
}

export const capabilities = (signal?: AbortSignal) => fhirFetch<CapabilityStatement>("metadata", { signal });

export const put = <T extends FhirResource>(resource: T & { id: string }) =>
  fhirFetch<T>(`${resource.resourceType}/${resource.id}`, { method: "PUT", body: JSON.stringify(resource) });
