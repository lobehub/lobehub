CREATE TABLE IF NOT EXISTS "dashboard_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"widget_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"layout" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"agent_id" text,
	"title" text NOT NULL,
	"description" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"visibility" text DEFAULT 'public' NOT NULL,
	"deleted_at" timestamp with time zone,
	"is_deleted" boolean,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "widget_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"widget_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"exit_code" integer,
	"output" jsonb,
	"stdout" text,
	"stderr" text,
	"error" jsonb,
	"sandbox_id" text,
	"operation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "widget_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"widget_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"version" integer NOT NULL,
	"runtime" text NOT NULL,
	"script" text NOT NULL,
	"content_hash" text NOT NULL,
	"manifest" jsonb,
	"output_type" text NOT NULL,
	"view" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"change_note" text,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"source_type" text NOT NULL,
	"source_agent_id" text,
	"source_topic_id" text,
	"source_message_id" text,
	"source_operation_id" text,
	"parent_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"agent_id" text,
	"title" text NOT NULL,
	"description" text,
	"published_version_id" uuid,
	"draft_version_id" uuid,
	"schedule_pattern" text,
	"schedule_timezone" text,
	"next_run_at" timestamp with time zone,
	"last_run_id" uuid,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_run_error" jsonb,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"latest_output" jsonb,
	"latest_output_at" timestamp with time zone,
	"metric_id" text,
	"metadata" jsonb,
	"visibility" text DEFAULT 'public' NOT NULL,
	"deleted_at" timestamp with time zone,
	"is_deleted" boolean,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD COLUMN IF NOT EXISTS "direction" text;--> statement-breakpoint
ALTER TABLE "dashboard_items" DROP CONSTRAINT IF EXISTS "dashboard_items_dashboard_id_dashboards_id_fk";--> statement-breakpoint
ALTER TABLE "dashboard_items" ADD CONSTRAINT "dashboard_items_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_items" DROP CONSTRAINT IF EXISTS "dashboard_items_widget_id_widgets_id_fk";--> statement-breakpoint
ALTER TABLE "dashboard_items" ADD CONSTRAINT "dashboard_items_widget_id_widgets_id_fk" FOREIGN KEY ("widget_id") REFERENCES "public"."widgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_items" DROP CONSTRAINT IF EXISTS "dashboard_items_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "dashboard_items" ADD CONSTRAINT "dashboard_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_items" DROP CONSTRAINT IF EXISTS "dashboard_items_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "dashboard_items" ADD CONSTRAINT "dashboard_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" DROP CONSTRAINT IF EXISTS "dashboards_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" DROP CONSTRAINT IF EXISTS "dashboards_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" DROP CONSTRAINT IF EXISTS "dashboards_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" DROP CONSTRAINT IF EXISTS "dashboards_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_runs" DROP CONSTRAINT IF EXISTS "widget_runs_widget_id_widgets_id_fk";--> statement-breakpoint
ALTER TABLE "widget_runs" ADD CONSTRAINT "widget_runs_widget_id_widgets_id_fk" FOREIGN KEY ("widget_id") REFERENCES "public"."widgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_runs" DROP CONSTRAINT IF EXISTS "widget_runs_version_id_widget_versions_id_fk";--> statement-breakpoint
ALTER TABLE "widget_runs" ADD CONSTRAINT "widget_runs_version_id_widget_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."widget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_runs" DROP CONSTRAINT IF EXISTS "widget_runs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "widget_runs" ADD CONSTRAINT "widget_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_runs" DROP CONSTRAINT IF EXISTS "widget_runs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "widget_runs" ADD CONSTRAINT "widget_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_versions" DROP CONSTRAINT IF EXISTS "widget_versions_widget_id_widgets_id_fk";--> statement-breakpoint
ALTER TABLE "widget_versions" ADD CONSTRAINT "widget_versions_widget_id_widgets_id_fk" FOREIGN KEY ("widget_id") REFERENCES "public"."widgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_versions" DROP CONSTRAINT IF EXISTS "widget_versions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "widget_versions" ADD CONSTRAINT "widget_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_versions" DROP CONSTRAINT IF EXISTS "widget_versions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "widget_versions" ADD CONSTRAINT "widget_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_versions" DROP CONSTRAINT IF EXISTS "widget_versions_published_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "widget_versions" ADD CONSTRAINT "widget_versions_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_versions" DROP CONSTRAINT IF EXISTS "widget_versions_source_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "widget_versions" ADD CONSTRAINT "widget_versions_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_versions" DROP CONSTRAINT IF EXISTS "widget_versions_source_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "widget_versions" ADD CONSTRAINT "widget_versions_source_topic_id_topics_id_fk" FOREIGN KEY ("source_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widget_versions" DROP CONSTRAINT IF EXISTS "widget_versions_parent_version_id_widget_versions_id_fk";--> statement-breakpoint
ALTER TABLE "widget_versions" ADD CONSTRAINT "widget_versions_parent_version_id_widget_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."widget_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" DROP CONSTRAINT IF EXISTS "widgets_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" DROP CONSTRAINT IF EXISTS "widgets_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" DROP CONSTRAINT IF EXISTS "widgets_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" DROP CONSTRAINT IF EXISTS "widgets_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" DROP CONSTRAINT IF EXISTS "widgets_published_version_id_widget_versions_id_fk";--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_published_version_id_widget_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."widget_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" DROP CONSTRAINT IF EXISTS "widgets_draft_version_id_widget_versions_id_fk";--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_draft_version_id_widget_versions_id_fk" FOREIGN KEY ("draft_version_id") REFERENCES "public"."widget_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" DROP CONSTRAINT IF EXISTS "widgets_metric_id_metrics_id_fk";--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_items_dashboard_id_widget_id_unique" ON "dashboard_items" USING btree ("dashboard_id","widget_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_items_dashboard_id_sort_order_idx" ON "dashboard_items" USING btree ("dashboard_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_items_widget_id_idx" ON "dashboard_items" USING btree ("widget_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_items_user_id_idx" ON "dashboard_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_items_workspace_id_idx" ON "dashboard_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_personal_idx" ON "dashboards" USING btree ("user_id","sort_order") WHERE "dashboards"."workspace_id" IS NULL AND "dashboards"."project_id" IS NULL AND "dashboards"."agent_id" IS NULL AND "dashboards"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_workspace_idx" ON "dashboards" USING btree ("workspace_id","sort_order") WHERE "dashboards"."workspace_id" IS NOT NULL AND "dashboards"."project_id" IS NULL AND "dashboards"."agent_id" IS NULL AND "dashboards"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_project_idx" ON "dashboards" USING btree ("project_id","sort_order") WHERE "dashboards"."project_id" IS NOT NULL AND "dashboards"."agent_id" IS NULL AND "dashboards"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_agent_idx" ON "dashboards" USING btree ("agent_id","sort_order") WHERE "dashboards"."agent_id" IS NOT NULL AND "dashboards"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_user_id_idx" ON "dashboards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboards_workspace_id_idx" ON "dashboards" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_runs_widget_id_created_at_idx" ON "widget_runs" USING btree ("widget_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_runs_version_id_idx" ON "widget_runs" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_runs_user_id_idx" ON "widget_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_runs_workspace_id_idx" ON "widget_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "widget_versions_widget_id_version_unique" ON "widget_versions" USING btree ("widget_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_versions_user_id_idx" ON "widget_versions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_versions_workspace_id_idx" ON "widget_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_versions_source_agent_id_idx" ON "widget_versions" USING btree ("source_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_versions_source_topic_id_idx" ON "widget_versions" USING btree ("source_topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_versions_parent_version_id_idx" ON "widget_versions" USING btree ("parent_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_personal_idx" ON "widgets" USING btree ("user_id","updated_at") WHERE "widgets"."workspace_id" IS NULL AND "widgets"."project_id" IS NULL AND "widgets"."agent_id" IS NULL AND "widgets"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_workspace_idx" ON "widgets" USING btree ("workspace_id","updated_at") WHERE "widgets"."workspace_id" IS NOT NULL AND "widgets"."project_id" IS NULL AND "widgets"."agent_id" IS NULL AND "widgets"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_project_idx" ON "widgets" USING btree ("project_id","updated_at") WHERE "widgets"."project_id" IS NOT NULL AND "widgets"."agent_id" IS NULL AND "widgets"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_agent_idx" ON "widgets" USING btree ("agent_id","updated_at") WHERE "widgets"."agent_id" IS NOT NULL AND "widgets"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_due_idx" ON "widgets" USING btree ("next_run_at") WHERE "widgets"."next_run_at" IS NOT NULL AND "widgets"."schedule_pattern" IS NOT NULL AND "widgets"."published_version_id" IS NOT NULL AND "widgets"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_user_id_idx" ON "widgets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_workspace_id_idx" ON "widgets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_published_version_id_idx" ON "widgets" USING btree ("published_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_draft_version_id_idx" ON "widgets" USING btree ("draft_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widgets_metric_id_idx" ON "widgets" USING btree ("metric_id");