import { healthRouter } from "@/server/api/routers/health";
import { clinicRouter } from "@/server/api/routers/clinic";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

export const appRouter = createTRPCRouter({
  clinic: clinicRouter,
  health: healthRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller, used by the Matrix bot and scripts: `createCaller(createContext(actor))`. */
export const createCaller = createCallerFactory(appRouter);
