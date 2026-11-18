CREATE TABLE IF NOT EXISTS "deploy_resume_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"task_id" text,
	"topic_id" text NOT NULL,
	"operation_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"resumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deploy_resume_queue_status_created_at_idx" ON "deploy_resume_queue" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deploy_resume_queue_topic_id_unique" ON "deploy_resume_queue" USING btree ("topic_id");
