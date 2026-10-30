import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";
import * as schema from "./schema";

// Reuse one connection pool across Next.js hot reloads.
const globalForDb = globalThis as unknown as { pg?: postgres.Sql };
const client = globalForDb.pg ?? postgres(env.DATABASE_URL, { max: 10 });
if (env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
/** A transaction from `db.transaction`, for helpers that take either. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
