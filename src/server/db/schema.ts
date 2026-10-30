import { integer, jsonb, pgEnum, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

import type { DocumentType } from "@/lib/document-types";
import { REQUEST_STATES } from "../requests/lifecycle";

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

export const requestState = pgEnum("request_state", REQUEST_STATES);
export const channel = pgEnum("channel", ["email", "sms"]);

// One row per request. docs/ARCHITECTURE.md, "Storage" and "Request lifecycle".
export const requests = pgTable("requests", {
  id: serial("id").primaryKey(),
  // A key of DOCUMENT_TYPES in src/lib/document-types.ts. Plain text, so a new document type needs no migration.
  docType: text("doc_type").$type<DocumentType>().notNull(),
  // The FHIR Patient id.
  patientId: text("patient_id").notNull(),
  // The person Dr. Hofer asked for, as she typed it.
  given: text("given").notNull(),
  family: text("family").notNull(),
  org: text("org").notNull(),
  channel: channel("channel").notNull(),
  // The email address or the mobile number.
  address: text("address").notNull(),
  // The network member who sent the request: Matrix ID and display name at that time.
  requester: text("requester").notNull(),
  requesterName: text("requester_name").notNull(),
  state: requestState("state").notNull(),
  // SHA-256 of the link token, hex. The token itself is never stored.
  linkHash: text("link_hash").notNull().unique(),
  failedChecks: integer("failed_checks").notNull().default(0),
  // The bPK of the person who passed the identity check, or who was held and then accepted. Only this person may answer.
  personNumber: text("person_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Dr. Hofer's room and the event that starts the request's thread there (T05).
  matrixRoom: text("matrix_room"),
  matrixEvent: text("matrix_event"),
});

/** The sender of a held answer, as ID Austria named them at login. */
export type HeldAnswerSender = { givenName: string; familyName: string; gdaOid: string | null };

// An answer that passed the patient check but waits for Dr. Hofer, because the release check did not pass.
// Accept files it and deletes the row, Reject deletes it. docs/ARCHITECTURE.md, "Storage".
export const heldAnswers = pgTable("held_answers", {
  requestId: integer("request_id")
    .primaryKey()
    .references(() => requests.id, { onDelete: "cascade" }),
  // The upload as text. It passed the patient check, so it is about the requested patient.
  markdown: text("markdown").notNull(),
  sha256: text("sha256").notNull(),
  sender: jsonb("sender").$type<HeldAnswerSender>().notNull(),
  // The ID token from the sender's login, exactly as received, for the Provenance signature.
  idToken: text("id_token").notNull(),
  // The sentence Dr. Hofer got with the held notice.
  reason: text("reason").notNull(),
  // When the sender pressed send.
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
});

// Which ID Austria person number answered as a given person at a given organisation. docs/IDENTITY.md, "Person number binding".
export const bindings = pgTable(
  "bindings",
  {
    given: text("given").notNull(),
    family: text("family").notNull(),
    org: text("org").notNull(),
    // The bPK from `urn:pvpgvat:oidc.bpk`, never `sub`.
    personNumber: text("person_number").notNull(),
    // The FHIR Practitioner of this person, for people without an eHVD entry.
    practitionerId: text("practitioner_id"),
    firstVerifiedAt: timestamp("first_verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.given, t.family, t.org] })],
);
