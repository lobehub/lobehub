CREATE TABLE IF NOT EXISTS "work_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" text NOT NULL,
	"version" integer NOT NULL,
	"title" text,
	"description" text,
	"content" text,
	"identifier" text,
	"status" text,
	"url" text,
	"change_type" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_identifier" text NOT NULL,
	"topic_id" text,
	"thread_id" text,
	"message_id" text,
	"root_operation_id" text,
	"tool_call_id" text,
	"agent_id" text,
	"metadata" jsonb,
	"cumulative_cost" numeric(20, 6),
	"cumulative_usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "works" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"current_version_id" uuid,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"title" text,
	"description" text,
	"identifier" text,
	"status" text,
	"url" text,
	"tool_name" text NOT NULL,
	"tool_identifier" text NOT NULL,
	"origin_topic_id" text,
	"origin_thread_id" text,
	"origin_agent_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"visibility" text NOT NULL,
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
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_message_id_messages_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_versions" DROP CONSTRAINT IF EXISTS "work_versions_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "work_versions" ADD CONSTRAINT "work_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT IF EXISTS "works_origin_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_origin_topic_id_topics_id_fk" FOREIGN KEY ("origin_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT IF EXISTS "works_origin_thread_id_threads_id_fk";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_origin_thread_id_threads_id_fk" FOREIGN KEY ("origin_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT IF EXISTS "works_origin_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_origin_agent_id_agents_id_fk" FOREIGN KEY ("origin_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT IF EXISTS "works_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" DROP CONSTRAINT IF EXISTS "works_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_versions_work_id_version_unique" ON "work_versions" USING btree ("work_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_versions_work_id_tool_call_id_unique" ON "work_versions" USING btree ("work_id","tool_call_id") WHERE "work_versions"."tool_call_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_thread_id_idx" ON "work_versions" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_message_id_idx" ON "work_versions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_agent_id_idx" ON "work_versions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_root_operation_created_at_idx" ON "work_versions" USING btree ("root_operation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_topic_created_at_idx" ON "work_versions" USING btree ("topic_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_versions_topic_thread_created_at_idx" ON "work_versions" USING btree ("topic_id","thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "works_resource_user_unique" ON "works" USING btree ("resource_type","resource_id","user_id") WHERE "works"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "works_resource_workspace_unique" ON "works" USING btree ("workspace_id","resource_type","resource_id") WHERE "works"."workspace_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_user_id_idx" ON "works" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_workspace_id_idx" ON "works" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_workspace_visibility_idx" ON "works" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_user_updated_at_id_idx" ON "works" USING btree ("user_id","updated_at","id") WHERE "works"."workspace_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_workspace_updated_at_id_idx" ON "works" USING btree ("workspace_id","updated_at","id") WHERE "works"."workspace_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_origin_topic_id_idx" ON "works" USING btree ("origin_topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_origin_thread_id_idx" ON "works" USING btree ("origin_thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "works_origin_agent_id_idx" ON "works" USING btree ("origin_agent_id");