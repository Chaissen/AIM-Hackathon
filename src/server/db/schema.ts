import { integer, jsonb, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// The six event types the jury counts (track README, "Audit coverage"). See docs/ARCHITECTURE.md, "Audit log".
export const auditEvent = pgEnum("audit_event", [
  "request_sent",
  "link_opened",
  "identity_checked",
  "answer_sent",
  "answer_filed",
  "misdelivery_caught",
]);

export const actorKind = pgEnum("actor_kind", ["network_member", "outside_person", "anonymous", "service"]);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  event: auditEvent("event").notNull(),
  requestId: integer("request_id"),
  actorKind: actorKind("actor_kind").notNull(),
  actor: text("actor").notNull(),
  outcome: text("outcome").notNull(),
  // Never document text. Hashes, ids and check results only.
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
});
