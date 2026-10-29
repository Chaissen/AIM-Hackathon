import { healthRouter } from "@/server/api/routers/health";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

export const appRouter = createTRPCRouter({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller, used by the Matrix bot and scripts: `createCaller(createContext(actor))`. */
export const createCaller = createCallerFactory(appRouter);
