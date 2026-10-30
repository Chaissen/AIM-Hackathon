import { healthRouter } from "@/server/api/routers/health";
import { clinicRouter } from "@/server/api/routers/clinic";
import { directoryRouter } from "@/server/api/routers/directory";
import { documentRouter } from "@/server/api/routers/document";
import { metricsRouter } from "@/server/api/routers/metrics";
import { portalRouter } from "@/server/api/routers/portal";
import { requestRouter } from "@/server/api/routers/request";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

export const appRouter = createTRPCRouter({
  clinic: clinicRouter,
  directory: directoryRouter,
  document: documentRouter,
  health: healthRouter,
  metrics: metricsRouter,
  portal: portalRouter,
  request: requestRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller, used by the Matrix bot and scripts: `createCaller(createContext(actor))`. */
export const createCaller = createCallerFactory(appRouter);
