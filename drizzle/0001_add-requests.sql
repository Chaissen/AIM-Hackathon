CREATE TYPE "public"."channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."request_state" AS ENUM('awaiting_confirmation', 'sent', 'identity_held', 'verified', 'answer_held', 'filed', 'cancelled', 'expired', 'locked');--> statement-breakpoint
CREATE TABLE "bindings" (
	"given" text NOT NULL,
	"family" text NOT NULL,
	"org" text NOT NULL,
	"person_number" text NOT NULL,
	"practitioner_id" text,
	"first_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bindings_given_family_org_pk" PRIMARY KEY("given","family","org")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_type" text NOT NULL,
	"patient_id" text NOT NULL,
	"given" text NOT NULL,
	"family" text NOT NULL,
	"org" text NOT NULL,
	"channel" "channel" NOT NULL,
	"address" text NOT NULL,
	"requester" text NOT NULL,
	"requester_name" text NOT NULL,
	"state" "request_state" NOT NULL,
	"link_hash" text NOT NULL,
	"failed_checks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"matrix_room" text,
	"matrix_event" text,
	CONSTRAINT "requests_link_hash_unique" UNIQUE("link_hash")
);
