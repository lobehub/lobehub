-- The Work registry has never shipped: this migration was regenerated in place
-- during PR review (snapshot jsonb dropped, display columns added, uuid version
-- ids), so preview/dev DBs that applied the earlier revision hold the OLD shape
-- under the same table names. Converge them by dropping the branch-local tables
-- first (they carry no production data); on a first-time run both drops are
-- no-ops. The IF [NOT] EXISTS guards keep the file rerunnable end to end.
DROP TABLE IF EXISTS "work_versions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "works" CASCADE;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" text NOT NULL,
	"version" integer NOT NULL,
	"change_type" text NOT NULL,
	"source_tool_name" text NOT NULL,
	"source_tool_identifier" text,
	"topic_id" text,
	"thread_id" text,
	"source_message_id" text,
	"root_operation_id" text,
	"source_tool_call_id" text,
	"actor_agent_id" text,
	"metadata" jsonb,
	"cumulative_cost" numeric(20, 6),
	"cumulative_usage" jsonb,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "works" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"current_version_id" uuid,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"source_tool_identifier" text,
	"title" text,
	"description" text,
	"content" text,
	"identifier" text,
	"status" text,
	"url" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_work_id_works_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_thread_id_threads_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_source_message_id_messages_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_actor_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT IF EXISTS "works_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT IF EXISTS "works_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_versions_work_id_version_unique" ON "work_versions" USING btree ("work_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_versions_work_id_source_tool_call_id_unique" ON "work_versions" USING btree ("work_id","source_tool_call_id") WHERE "work_versions"."source_tool_call_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_work_id_idx" ON "work_versions" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_topic_id_idx" ON "work_versions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_thread_id_idx" ON "work_versions" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_source_message_id_idx" ON "work_versions" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_root_operation_id_idx" ON "work_versions" USING btree ("root_operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_user_id_idx" ON "work_versions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_workspace_id_idx" ON "work_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_created_at_idx" ON "work_versions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "works_resource_user_unique" ON "works" USING btree ("resource_type","resource_id","user_id") WHERE "works"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "works_resource_workspace_unique" ON "works" USING btree ("workspace_id","resource_type","resource_id") WHERE "works"."workspace_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_user_id_idx" ON "works" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_workspace_id_idx" ON "works" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_resource_idx" ON "works" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_current_version_id_idx" ON "works" USING btree ("current_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_updated_at_idx" ON "works" USING btree ("updated_at");
