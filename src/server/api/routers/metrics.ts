import { clinicProcedure, createTRPCRouter } from "@/server/api/trpc";
import { auditLog, requests } from "@/server/db/schema";
import { metricsOverview } from "@/server/metrics/live";
import { readLastRuns } from "@/server/metrics/runs";
import { listRequests } from "@/server/requests/service";

export const metricsRouter = createTRPCRouter({
  overview: clinicProcedure.query(async ({ ctx }) => {
    // listRequests expires due requests first, so the table shows the states the Requests view shows.
    const [own, audit, all, runs] = await Promise.all([
      listRequests(ctx.db, ctx.actor.mxid),
      ctx.db.select().from(auditLog),
      ctx.db.select({ id: requests.id, docType: requests.docType, address: requests.address, createdAt: requests.createdAt }).from(requests),
      readLastRuns(),
    ]);
    return metricsOverview({ at: new Date(), audit, requests: all, own, runs });
  }),
});
