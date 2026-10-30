import type { TRPCLink } from "@trpc/client";
import { z } from "zod";

import type { AppRouter } from "@/server/api/root";

import { failingLink, fixtureLink, type Fixtures } from "../fixture-link";
import { clinicFixtures } from "./clinic";
import { directoryFixtures } from "./directory";
import { documentFixtures } from "./document";
import { metricsFixtures } from "./metrics";
import { emptyStore, type FixtureStore, requestFixtures, seededStore } from "./request";

const FIXTURE_SETS = ["seeded", "empty", "failing"] as const;
export type FixtureSet = (typeof FIXTURE_SETS)[number];

const fixtureSet = z.enum(FIXTURE_SETS).catch("seeded");

/** The set named by `?fixtures=`; anything else is `seeded`. */
export const parseFixtureSet = (value: string | null): FixtureSet => fixtureSet.parse(value);

const widgetFixtures = (store: FixtureStore, { listed }: { listed: boolean }): Fixtures => ({
  clinic: clinicFixtures(store),
  directory: directoryFixtures({ listed }),
  document: documentFixtures(store),
  metrics: metricsFixtures(store),
  request: requestFixtures(store),
});

export function fixtureLinkFor(set: FixtureSet): TRPCLink<AppRouter> {
  switch (set) {
    case "seeded":
      return fixtureLink(widgetFixtures(seededStore(), { listed: true }), 150);
    case "empty":
      return fixtureLink(widgetFixtures(emptyStore(), { listed: false }), 150);
    case "failing":
      return failingLink(300);
    default:
      return set satisfies never;
  }
}
