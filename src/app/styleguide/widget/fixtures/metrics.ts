import { effortSeconds, latestRequest1, requestCoverage, TRACK_EVENTS } from "@/server/metrics/audit";
import type { RouterOutputs } from "@/trpc/types";

import type { RouterFixtures } from "../fixture-link";
import type { FixtureStore } from "./request";

type MetricsOverview = RouterOutputs["metrics"]["overview"];

const HOUR_MS = 60 * 60 * 1000;

const notMeasured = (at: Date, requests: MetricsOverview["requests"]): MetricsOverview => ({
  at,
  validation: { status: "not_measured", lastRun: null, filedSince: 0 },
  effort: { status: "not_measured", seconds: null, requestId: null },
  misdeliveries: { status: "not_measured", caught: 0, tests: (["M1", "M2", "M3"] as const).map((id) => ({ id, status: "not_run", requestId: null })) },
  coverage: { status: "not_measured", covered: 0, total: TRACK_EVENTS.length, requestId: null, events: TRACK_EVENTS.map((event) => ({ event, covered: false })) },
  requests,
  lastScenario: null,
});

export const metricsFixtures = (store: FixtureStore): RouterFixtures<"metrics"> => ({
  overview: () => {
    const at = new Date();
    const requests = [...store.requests]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
      .map((r) => ({
        id: r.id,
        docType: r.docType,
        person: `${r.given.trim()} ${r.family.trim()}`,
        state: r.state,
        effortSeconds: effortSeconds(store.audit, r.id),
        covered: requestCoverage(r.id, store.audit).covered,
      }));
    const request1 = latestRequest1(store.requests);
    if (request1 === undefined) return notMeasured(at, requests);

    const coverage = requestCoverage(request1, store.audit);
    const lastRun = { at: new Date(at.getTime() - HOUR_MS), errors: 0, resources: 19, source: "pnpm validate" as const };
    return {
      at,
      validation: { status: "met", lastRun, filedSince: 0 },
      effort: { status: "met", seconds: effortSeconds(store.audit, request1), requestId: request1 },
      misdeliveries: {
        status: "met",
        caught: 3,
        tests: [
          { id: "M1", status: "caught", requestId: 3 },
          { id: "M2", status: "caught", requestId: request1 },
          { id: "M3", status: "caught", requestId: request1 },
        ],
      },
      coverage: {
        status: "met",
        covered: coverage.covered,
        total: TRACK_EVENTS.length,
        requestId: request1,
        events: TRACK_EVENTS.map((event) => ({ event, covered: coverage.events.some((e) => e.event === event && e.complete > 0) })),
      },
      requests,
      lastScenario: {
        at: new Date(at.getTime() - 2 * HOUR_MS),
        metrics: [
          { name: "FHIR validation", target: "0 errors", result: "0 errors in 19 resources", status: "met" },
          {
            name: "Effort for the outside person",
            target: "0 installs, 0 accounts, under 2 minutes",
            result: "automated run: 74 s from link_opened to the answer_sent that was filed, machine time, not a person (a person's effort: docs/clinical-review/TIMED_TEST_20.md)",
            status: "met",
          },
          { name: "Misdeliveries caught", target: "3 of 3", result: "3 of 3", status: "met" },
          { name: "Audit coverage", target: "6 of 6 on request 1", result: "6 of 6 on request 1", status: "met" },
        ],
      },
    };
  },
});
