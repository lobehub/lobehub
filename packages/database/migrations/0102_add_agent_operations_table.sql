CREATE TABLE IF NOT EXISTS "agent_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"topic_id" text,
	"thread_id" text,
	"task_id" text,
	"chat_group_id" text,
	"parent_operation_id" text,
	"status" text NOT NULL,
	"completion_reason" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"step_count" integer,
	"max_steps" integer,
	"force_finish" boolean,
	"interruption" jsonb,
	"error" jsonb,
	"total_cost" numeric(20, 6),
	"currency" text DEFAULT 'USD' NOT NULL,
	"total_input_tokens" integer,
	"total_output_tokens" integer,
	"total_tokens" integer,
	"llm_calls" integer,
	"tool_calls" integer,
	"human_interventions" integer,
	"processing_time_ms" integer,
	"human_waiting_time_ms" integer,
	"cost" jsonb,
	"usage" jsonb,
	"cost_limit" jsonb,
	"model" text,
	"provider" text,
	"model_runtime_config" jsonb,
	"trigger" text,
	"app_context" jsonb,
	"trace_s3_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT IF EXISTS "agent_operations_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT IF EXISTS "agent_operations_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT IF EXISTS "agent_operations_thread_id_threads_id_fk";--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT IF EXISTS "agent_operations_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT IF EXISTS "agent_operations_chat_group_id_chat_groups_id_fk";--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_user_id_idx" ON "agent_operations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_agent_id_idx" ON "agent_operations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_topic_id_idx" ON "agent_operations" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_thread_id_idx" ON "agent_operations" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_task_id_idx" ON "agent_operations" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_chat_group_id_idx" ON "agent_operations" USING btree ("chat_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_parent_operation_id_idx" ON "agent_operations" USING btree ("parent_operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_status_idx" ON "agent_operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_user_id_created_at_idx" ON "agent_operations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_metadata_idx" ON "agent_operations" USING gin ("metadata");
