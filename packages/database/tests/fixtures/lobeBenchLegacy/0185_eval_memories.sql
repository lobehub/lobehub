CREATE TABLE IF NOT EXISTS "agent_eval_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"run_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"thread_id" text,
	"attempt_id" text NOT NULL,
	"layer" text NOT NULL,
	"source" text NOT NULL,
	"fixture_hash" text,
	"title" text,
	"summary" text,
	"details" text,
	"memory_category" text,
	"memory_type" text,
	"tags" jsonb,
	"payload" jsonb NOT NULL,
	"embedding" vector(1024),
	"captured_at" timestamp with time zone NOT NULL,
	"removed_reason" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_run_id_agent_eval_runs_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_run_id_agent_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_thread_id_threads_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_attempt_id_idx" ON "agent_eval_memories" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_run_id_idx" ON "agent_eval_memories" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_user_id_idx" ON "agent_eval_memories" USING btree ("user_id");