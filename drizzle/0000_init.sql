CREATE TYPE "public"."actor_kind" AS ENUM('network_member', 'outside_person', 'anonymous', 'service');--> statement-breakpoint
CREATE TYPE "public"."audit_event" AS ENUM('request_sent', 'link_opened', 'identity_checked', 'answer_sent', 'answer_filed', 'misdelivery_caught');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" "audit_event" NOT NULL,
	"request_id" integer,
	"actor_kind" "actor_kind" NOT NULL,
	"actor" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
