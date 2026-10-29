import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod";

import { EID_SESSION_COOKIE, readEidSession, type EidSession } from "@/server/auth/eid-session";
import { db } from "@/server/db";
import { verifyOpenIdToken } from "@/server/matrix/client";

/**
 * Who is calling:
 * - clinic: a member of the closed network (Dr. Hofer). From the widget via a Matrix OpenID token,
 *   from the bot via `createCaller` with the sender's Matrix ID.
 * - eid: an outside person after the ID Austria login, bound to one request link.
 */
export type Actor = { kind: "clinic"; mxid: string } | { kind: "eid"; session: EidSession } | { kind: "anonymous" };

export const createContext = (actor: Actor) => ({ db, actor });
export type Context = ReturnType<typeof createContext>;

export async function createContextFromRequest(req: Request): Promise<Context> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const clinic = bearer ? await verifyOpenIdToken(bearer) : null;
  if (clinic) return createContext({ kind: "clinic", mxid: clinic });

  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${EID_SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await readEidSession(cookie);
  if (session) return createContext({ kind: "eid", session });

  return createContext({ kind: "anonymous" });
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: { ...shape.data, zodError: error.cause instanceof ZodError ? z.flattenError(error.cause) : null },
  }),
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

export const publicProcedure = t.procedure;

export const clinicProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.actor.kind !== "clinic") throw new TRPCError({ code: "UNAUTHORIZED", message: "Network members only" });
  return next({ ctx: { ...ctx, actor: ctx.actor } });
});

export const eidProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.actor.kind !== "eid") throw new TRPCError({ code: "UNAUTHORIZED", message: "Log in with ID Austria first" });
  return next({ ctx: { ...ctx, actor: ctx.actor } });
});
