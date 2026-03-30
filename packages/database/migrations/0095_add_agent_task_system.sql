CREATE TABLE IF NOT EXISTS "briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text,
	"cron_job_id" text,
	"topic_id" text,
	"agent_id" text,
	"type" text NOT NULL,
	"priority" text DEFAULT 'info',
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"artifacts" jsonb,
	"actions" jsonb,
	"resolved_action" text,
	"resolved_comment" text,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"author_user_id" text,
	"author_agent_id" text,
	"content" text NOT NULL,
	"editor_data" jsonb,
	"brief_id" text,
	"topic_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"depends_on_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text DEFAULT 'blocks' NOT NULL,
	"condition" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pinned_by" text DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"topic_id" text,
	"user_id" text NOT NULL,
	"seq" integer NOT NULL,
	"operation_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"handoff" jsonb,
	"review_passed" integer,
	"review_score" integer,
	"review_scores" jsonb,
	"review_iteration" integer,
	"reviewed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"seq" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_agent_id" text,
	"assignee_user_id" text,
	"assignee_agent_id" text,
	"parent_task_id" text,
	"name" text,
	"description" varchar(255),
	"instruction" text NOT NULL,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" integer DEFAULT 0,
	"sort_order" integer DEFAULT 0,
	"heartbeat_interval" integer DEFAULT 300,
	"heartbeat_timeout" integer,
	"last_heartbeat_at" timestamp with time zone,
	"schedule_pattern" text,
	"schedule_timezone" text DEFAULT 'UTC',
	"total_topics" integer DEFAULT 0,
	"max_topics" integer,
	"current_topic_id" text,
	"context" jsonb DEFAULT '{}'::jsonb,
	"config" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_cron_job_id_agent_cron_jobs_id_fk";--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_cron_job_id_agent_cron_jobs_id_fk" FOREIGN KEY ("cron_job_id") REFERENCES "public"."agent_cron_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_author_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_author_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_brief_id_briefs_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" DROP CONSTRAINT IF EXISTS "task_dependencies_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" DROP CONSTRAINT IF EXISTS "task_dependencies_depends_on_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" DROP CONSTRAINT IF EXISTS "task_dependencies_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" DROP CONSTRAINT IF EXISTS "task_documents_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" DROP CONSTRAINT IF EXISTS "task_documents_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" DROP CONSTRAINT IF EXISTS "task_documents_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_topics" DROP CONSTRAINT IF EXISTS "task_topics_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_topics" ADD CONSTRAINT "task_topics_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_topics" DROP CONSTRAINT IF EXISTS "task_topics_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "task_topics" ADD CONSTRAINT "task_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_topics" DROP CONSTRAINT IF EXISTS "task_topics_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_topics" ADD CONSTRAINT "task_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_created_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_created_by_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_assignee_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_assignee_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_agent_id_agents_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_current_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_current_topic_id_topics_id_fk" FOREIGN KEY ("current_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_parent_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_user_id_idx" ON "briefs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_task_id_idx" ON "briefs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_cron_job_id_idx" ON "briefs" USING btree ("cron_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_agent_id_idx" ON "briefs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_type_idx" ON "briefs" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_priority_idx" ON "briefs" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_unresolved_idx" ON "briefs" USING btree ("user_id","resolved_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_task_id_idx" ON "task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_user_id_idx" ON "task_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_author_user_id_idx" ON "task_comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_agent_id_idx" ON "task_comments" USING btree ("author_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_brief_id_idx" ON "task_comments" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_topic_id_idx" ON "task_comments" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_deps_unique_idx" ON "task_dependencies" USING btree ("task_id","depends_on_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_deps_task_id_idx" ON "task_dependencies" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_deps_depends_on_id_idx" ON "task_dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_deps_user_id_idx" ON "task_dependencies" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_docs_unique_idx" ON "task_documents" USING btree ("task_id","document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_docs_task_id_idx" ON "task_documents" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_docs_document_id_idx" ON "task_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_docs_user_id_idx" ON "task_documents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_topics_unique_idx" ON "task_topics" USING btree ("task_id","topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_topics_task_id_idx" ON "task_topics" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_topics_topic_id_idx" ON "task_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_topics_user_id_idx" ON "task_topics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_topics_status_idx" ON "task_topics" USING btree ("task_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_identifier_idx" ON "tasks" USING btree ("identifier","created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_created_by_user_id_idx" ON "tasks" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_created_by_agent_id_idx" ON "tasks" USING btree ("created_by_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_user_id_idx" ON "tasks" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_agent_id_idx" ON "tasks" USING btree ("assignee_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_priority_idx" ON "tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_heartbeat_idx" ON "tasks" USING btree ("status","last_heartbeat_at");