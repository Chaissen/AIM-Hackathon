CREATE TABLE "kept_answers" (
	"request_id" integer PRIMARY KEY NOT NULL,
	"answer" jsonb NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kept_answers" ADD CONSTRAINT "kept_answers_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;