import { sql } from "drizzle-orm";

import { env } from "@/env";
import { clinicProcedure, createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { capabilities } from "@/server/fhir/client";

type Check = { ok: boolean; detail: string };

async function check(run: () => Promise<string>): Promise<Check> {
  try {
    return { ok: true, detail: await run() };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export const healthRouter = createTRPCRouter({
  check: publicProcedure.query(async ({ ctx }) => {
    const [database, fhir, matrix] = await Promise.all([
      check(async () => {
        await ctx.db.execute(sql`select 1`);
        return "Postgres reachable";
      }),
      check(async () => {
        const cs = await capabilities(AbortSignal.timeout(5_000));
        return `${cs.software?.name ?? "FHIR"} ${cs.software?.version ?? ""}, FHIR ${cs.fhirVersion}`.trim();
      }),
      check(async () => {
        const res = await fetch(`${env.MATRIX_HOMESERVER_URL}/_matrix/client/versions`, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return `Homeserver ${env.MATRIX_SERVER_NAME}`;
      }),
    ]);
    return { database, fhir, matrix, actor: ctx.actor.kind };
  }),

  whoami: clinicProcedure.query(({ ctx }) => ({ mxid: ctx.actor.mxid })),
});
