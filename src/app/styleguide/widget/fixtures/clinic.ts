import { TRPCError } from "@trpc/server";

import type { RouterOutputs } from "@/trpc/types";

import type { RouterFixtures } from "../fixture-link";
import { type FixtureStore, HOFER } from "./request";

type Contact = RouterOutputs["clinic"]["contacts"][number];

// Maria from track/scenario/patient.json, and the synthetic patients of requests 7 and 8.
const PATIENTS: RouterOutputs["clinic"]["patient"][] = [
  { id: "maria-beispiel", name: "Maria Beispiel", birthDate: "1961-03-12", gender: "female", address: "Musterstraße 1, 1000 Beispielstadt" },
  { id: "johann-muster", name: "Johann Muster", birthDate: "1948-07-02", gender: "male", address: null },
  { id: "petra-probst", name: "Petra Probst", birthDate: "1975-11-19", gender: "female", address: null },
];

export function clinicFixtures(store: FixtureStore): RouterFixtures<"clinic"> {
  return {
    me: () => ({ ...HOFER, clinic: "Klinikum Beispielstadt" }),
    patients: () => PATIENTS.map(({ id, name, birthDate }) => ({ id, name, birthDate })),
    patient: ({ id }) => {
      const patient = PATIENTS.find((p) => p.id === id);
      if (!patient) throw new TRPCError({ code: "NOT_FOUND", message: `Patient ${id} does not exist` });
      return patient;
    },
    contacts: () => {
      const contacts = new Map<string, Contact>();
      for (const r of [...store.requests].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)) {
        const key = JSON.stringify([r.given, r.family, r.org]);
        const known = contacts.get(key);
        if (known) known.requests++;
        else {
          const verified = store.bindings.some((b) => b.given === r.given && b.family === r.family && b.org === r.org);
          contacts.set(key, {
            given: r.given,
            family: r.family,
            org: r.org,
            channel: r.channel,
            address: r.address,
            docType: r.docType,
            requests: 1,
            lastRequestId: r.id,
            lastRequestedAt: r.createdAt,
            verified,
          });
        }
      }
      return [...contacts.values()];
    },
    audit: () => [...store.audit].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id).slice(0, 500),
  };
}
