import { z } from "zod";

import { byResourceType } from "@/server/documents/filed";
import { toDocumentView } from "@/server/documents/view";
import { filedReferences } from "@/server/metrics/audit";
import type { RouterOutputs } from "@/trpc/types";

import type { RouterFixtures } from "../fixture-link";
import type { FixtureStore } from "./request";

type PatientDocument = Extract<RouterOutputs["document"]["forPatient"], { status: "ok" }>["documents"][number];

const filedDetail = z.object({ output: z.string() });

// The held answers from the store's Postgres side, and the filed ones from its HAPI side, read as the router reads them.
export function documentFixtures(store: FixtureStore): RouterFixtures<"document"> {
  const filingOf = (requestId: number) => {
    const entry = store.audit.find((a) => a.requestId === requestId && a.event === "answer_filed");
    const detail = filedDetail.safeParse(entry?.detail);
    return entry && detail.success ? { at: entry.at, output: detail.data.output } : null;
  };

  return {
    forRequest: ({ id }) => {
      const held = store.held.get(id);
      if (held) {
        const answer = toDocumentView(held.markdown);
        if (!answer) return { status: "unavailable", reason: "unreadable" };
        const sender = `${held.sender.givenName} ${held.sender.familyName}`;
        return { status: "held", ...answer, sender, reason: held.reason, sentAt: held.sentAt };
      }
      const filing = filingOf(id);
      if (!filing) return { status: "none" };
      const markdown = store.filed.get(filing.output);
      if (markdown === undefined) return { status: "unavailable", reason: "not_found" };
      const answer = toDocumentView(markdown);
      if (!answer) return { status: "unavailable", reason: "unreadable" };
      return { status: "filed", ...answer, reference: filing.output, filedAt: filing.at };
    },

    filedResources: ({ id }) => {
      const references = filedReferences(store.audit.filter((a) => a.requestId === id)).sort(byResourceType);
      if (!references.length) return { status: "none" };
      const resources = references.map((reference) => {
        const [resourceType, resourceId] = reference.split("/");
        return { reference, resourceType, resource: { resourceType, id: resourceId, meta: { versionId: "1" } } };
      });
      return { status: "ok", resources };
    },

    // HAPI holds every filed answer for the patient. The DiagnosticReport's date is the lab's report time, the
    // DocumentReference's the filing time, as the mappers write them. Every one of them was filed by ordy here.
    forPatient: ({ patientId }) => {
      const documents = store.requests
        .filter((r) => r.patientId === patientId)
        .flatMap((r): PatientDocument[] => {
          const filing = filingOf(r.id);
          const markdown = filing ? store.filed.get(filing.output) : undefined;
          if (!filing || markdown === undefined) return [];
          const answer = toDocumentView(markdown);
          const date = answer?.document.type === "lab-result" ? answer.document.reported : filing.at.toISOString();
          const title = answer?.document.title ?? filing.output;
          return [
            { reference: filing.output, type: r.docType, title, date, filedAt: filing.at, document: answer?.document ?? null, original: answer?.original ?? null },
          ];
        })
        .sort((a, b) => (b.filedAt?.getTime() ?? 0) - (a.filedAt?.getTime() ?? 0));
      return { status: "ok", documents };
    },
  };
}
