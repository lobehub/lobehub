CREATE TABLE IF NOT EXISTS "goal_traces" (
	"goal_id" text PRIMARY KEY NOT NULL,
	"trace_s3_key" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"final_status" text,
	"advances_total" integer,
	"ticks_total" integer,
	"advances_by_trigger" jsonb,
	"advances_by_outcome" jsonb,
	"ticks_by_branch" jsonb,
	"total_cost" numeric(20, 6),
	"work_operations" integer,
	"nodes_total" integer,
	"work_resolved" integer,
	"work_retired" integer,
	"findings_total" integer,
	"gates_opened" integer,
	"gates_resolved" integer,
	"human_waiting_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trash_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"title" text,
	"meta" jsonb,
	"root_id" uuid,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"deleted_by_user_id" text,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ALTER COLUMN "benchmark_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "generation_topics" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_topics" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
ALTER TABLE "goal_traces" DROP CONSTRAINT IF EXISTS "goal_traces_goal_id_goals_id_fk";--> statement-breakpoint
ALTER TABLE "goal_traces" ADD CONSTRAINT "goal_traces_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" DROP CONSTRAINT IF EXISTS "trash_items_root_id_trash_items_id_fk";--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_root_id_trash_items_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."trash_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" DROP CONSTRAINT IF EXISTS "trash_items_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" DROP CONSTRAINT IF EXISTS "trash_items_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_items" DROP CONSTRAINT IF EXISTS "trash_items_deleted_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "trash_items" ADD CONSTRAINT "trash_items_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_traces_started_at_idx" ON "goal_traces" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_traces_final_status_idx" ON "goal_traces" USING btree ("final_status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trash_items_resource_unique" ON "trash_items" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_personal_listing_idx" ON "trash_items" USING btree ("user_id","deleted_at") WHERE "trash_items"."root_id" IS NULL AND "trash_items"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_workspace_listing_idx" ON "trash_items" USING btree ("workspace_id","deleted_at") WHERE "trash_items"."root_id" IS NULL AND "trash_items"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_expires_at_idx" ON "trash_items" USING btree ("expires_at") WHERE "trash_items"."root_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_root_id_idx" ON "trash_items" USING btree ("root_id");