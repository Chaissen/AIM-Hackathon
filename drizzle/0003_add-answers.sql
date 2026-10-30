CREATE TABLE "held_answers" (
	"request_id" integer PRIMARY KEY NOT NULL,
	"markdown" text NOT NULL,
	"sha256" text NOT NULL,
	"sender" jsonb NOT NULL,
	"id_token" text NOT NULL,
	"reason" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "id_token" text;--> statement-breakpoint
ALTER TABLE "held_answers" ADD CONSTRAINT "held_answers_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;