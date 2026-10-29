import { desc } from "drizzle-orm";
import type { Bundle, Patient } from "fhir/r4";

import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { auditLog } from "@/server/db/schema";
import { fhirFetch } from "@/server/fhir/client";

export const clinicRouter = createTRPCRouter({
  patients: clinicProcedure.query(async () => {
    const bundle = await fhirFetch<Bundle<Patient>>("Patient?_count=50&_sort=family");
    return (bundle.entry ?? []).flatMap(({ resource: patient }) =>
      patient?.id
        ? [{
            id: patient.id,
            name: [...(patient.name?.[0]?.given ?? []), patient.name?.[0]?.family].filter(Boolean).join(" "),
            birthDate: patient.birthDate ?? null,
          }]
        : [],
    );
  }),
  audit: clinicProcedure.query(({ ctx }) => ctx.db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(500)),
});
