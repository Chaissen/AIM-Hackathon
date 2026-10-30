import { integer, jsonb, pgEnum, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";

import type { DocumentType } from "@/lib/document-types";
import type { KeptAnswer } from "@/server/answers/ports";
import { REQUEST_STATES } from "../requests/lifecycle";

export const auditEvent = pgEnum("audit_event", [
  "request_sent",
  "link_opened",
  "identity_checked",
  "answer_sent",
  "answer_filed",
  "misdelivery_caught",
  "request_decided",
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
  // The ID token of the last login, exactly as received, for the Provenance signature (T13).
  idToken: text("id_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Dr. Hofer's room and the event that starts the request's thread there (T05).
  matrixRoom: text("matrix_room"),
  matrixEvent: text("matrix_event"),
});

// The SMS screen (/sms) stands in for the recipient's phone, as Mailpit stands in for the inbox: one row per SMS the
// request service would have sent. The body holds the link, so this is the one table with a link token in plain text.
// A real SMS gateway replaces it. docs/ARCHITECTURE.md, "Outgoing messages".
export const smsOutbox = pgTable("sms_outbox", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  to: text("to").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
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
  // What the release check found before it held: the organisation's and the responsible person's eHVD OIDs, or null.
  // Accept files with them, so the Organization and the Practitioner are the ones the eHVD lists.
  organisationOid: text("organisation_oid"),
  practitionerOid: text("practitioner_oid"),
  // When the sender pressed send.
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
});

// An answer whose filing has an unknown outcome: the FHIR server may have filed it while the response was lost. Until
// it is filed, or the server refuses it, the request takes no other upload, and the next send files exactly this
// answer again. Lives only while the request is `verified` or, after an Accept, `answer_held`. docs/FHIR.md, "Retries".
export const keptAnswers = pgTable("kept_answers", {
  requestId: integer("request_id")
    .primaryKey()
    .references(() => requests.id, { onDelete: "cascade" }),
  // Everything the Bundle is built from, so the retry needs no new eHVD lookup and no new parse.
  answer: jsonb("answer").$type<KeptAnswer>().notNull(),
  failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
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
