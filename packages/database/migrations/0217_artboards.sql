CREATE TABLE IF NOT EXISTS "artboard_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artboard_id" text NOT NULL,
	"page_id" text NOT NULL,
	"group_id" text,
	"round_id" uuid,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"acceptance_flow_node_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"expected" text,
	"rect" jsonb NOT NULL,
	"source_work_version_id" uuid,
	"source_path" text,
	"source_file_id" text,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artboard_boards_single_source_check" CHECK (num_nonnulls("artboard_boards"."source_work_version_id", "artboard_boards"."source_file_id") <= 1),
	CONSTRAINT "artboard_boards_decision_no_source_check" CHECK ("artboard_boards"."type" <> 'decision' OR num_nonnulls("artboard_boards"."source_work_version_id", "artboard_boards"."source_file_id", "artboard_boards"."source_path") = 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artboard_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artboard_id" text NOT NULL,
	"parent_comment_id" uuid,
	"author_user_id" text,
	"author_agent_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"page_id" text,
	"group_id" text,
	"board_id" uuid,
	"content" text NOT NULL,
	"client_id" text NOT NULL,
	"anchor" jsonb,
	"delivered_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artboard_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artboard_id" text NOT NULL,
	"source_board_id" uuid NOT NULL,
	"target_board_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"acceptance_flow_edge_id" uuid,
	"label" text DEFAULT '' NOT NULL,
	"condition" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artboard_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"artboard_id" text NOT NULL,
	"page_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rect" jsonb NOT NULL,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artboard_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"artboard_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artboard_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artboard_id" text NOT NULL,
	"page_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"recommended_board_id" uuid,
	"chosen_board_id" uuid,
	"selected_by" text,
	"selected_at" timestamp with time zone,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artboards" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"topic_id" text,
	"task_id" text,
	"project_id" text,
	"acceptance_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"content" text,
	"phase" text DEFAULT 'discuss' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_artboard_id_artboards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_artboard_id_artboards_id_fk" FOREIGN KEY ("artboard_id") REFERENCES "public"."artboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_page_id_artboard_pages_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_page_id_artboard_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."artboard_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_group_id_artboard_groups_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_group_id_artboard_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."artboard_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_round_id_artboard_rounds_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_round_id_artboard_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."artboard_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_source_work_version_id_work_versions_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_source_work_version_id_work_versions_id_fk" FOREIGN KEY ("source_work_version_id") REFERENCES "public"."work_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_source_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_source_file_id_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_artboard_id_artboards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_artboard_id_artboards_id_fk" FOREIGN KEY ("artboard_id") REFERENCES "public"."artboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_parent_comment_id_artboard_comments_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_parent_comment_id_artboard_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."artboard_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_author_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_author_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_page_id_artboard_pages_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_page_id_artboard_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."artboard_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_group_id_artboard_groups_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_group_id_artboard_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."artboard_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_board_id_artboard_boards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_board_id_artboard_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."artboard_boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_comments" DROP CONSTRAINT IF EXISTS "artboard_comments_resolved_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_comments" ADD CONSTRAINT "artboard_comments_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_edges" DROP CONSTRAINT IF EXISTS "artboard_edges_artboard_id_artboards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_edges" ADD CONSTRAINT "artboard_edges_artboard_id_artboards_id_fk" FOREIGN KEY ("artboard_id") REFERENCES "public"."artboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_edges" DROP CONSTRAINT IF EXISTS "artboard_edges_source_board_id_artboard_boards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_edges" ADD CONSTRAINT "artboard_edges_source_board_id_artboard_boards_id_fk" FOREIGN KEY ("source_board_id") REFERENCES "public"."artboard_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_edges" DROP CONSTRAINT IF EXISTS "artboard_edges_target_board_id_artboard_boards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_edges" ADD CONSTRAINT "artboard_edges_target_board_id_artboard_boards_id_fk" FOREIGN KEY ("target_board_id") REFERENCES "public"."artboard_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_edges" DROP CONSTRAINT IF EXISTS "artboard_edges_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_edges" ADD CONSTRAINT "artboard_edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_edges" DROP CONSTRAINT IF EXISTS "artboard_edges_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_edges" ADD CONSTRAINT "artboard_edges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_groups" DROP CONSTRAINT IF EXISTS "artboard_groups_artboard_id_artboards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_groups" ADD CONSTRAINT "artboard_groups_artboard_id_artboards_id_fk" FOREIGN KEY ("artboard_id") REFERENCES "public"."artboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_groups" DROP CONSTRAINT IF EXISTS "artboard_groups_page_id_artboard_pages_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_groups" ADD CONSTRAINT "artboard_groups_page_id_artboard_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."artboard_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_groups" DROP CONSTRAINT IF EXISTS "artboard_groups_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_groups" ADD CONSTRAINT "artboard_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_groups" DROP CONSTRAINT IF EXISTS "artboard_groups_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_groups" ADD CONSTRAINT "artboard_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_pages" DROP CONSTRAINT IF EXISTS "artboard_pages_artboard_id_artboards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_pages" ADD CONSTRAINT "artboard_pages_artboard_id_artboards_id_fk" FOREIGN KEY ("artboard_id") REFERENCES "public"."artboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_pages" DROP CONSTRAINT IF EXISTS "artboard_pages_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_pages" ADD CONSTRAINT "artboard_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_pages" DROP CONSTRAINT IF EXISTS "artboard_pages_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_pages" ADD CONSTRAINT "artboard_pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_rounds" DROP CONSTRAINT IF EXISTS "artboard_rounds_artboard_id_artboards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_rounds" ADD CONSTRAINT "artboard_rounds_artboard_id_artboards_id_fk" FOREIGN KEY ("artboard_id") REFERENCES "public"."artboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_rounds" DROP CONSTRAINT IF EXISTS "artboard_rounds_page_id_artboard_pages_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_rounds" ADD CONSTRAINT "artboard_rounds_page_id_artboard_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."artboard_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_rounds" DROP CONSTRAINT IF EXISTS "artboard_rounds_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_rounds" ADD CONSTRAINT "artboard_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_rounds" DROP CONSTRAINT IF EXISTS "artboard_rounds_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_rounds" ADD CONSTRAINT "artboard_rounds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_rounds" DROP CONSTRAINT IF EXISTS "artboard_rounds_recommended_board_id_artboard_boards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_rounds" ADD CONSTRAINT "artboard_rounds_recommended_board_id_artboard_boards_id_fk" FOREIGN KEY ("recommended_board_id") REFERENCES "public"."artboard_boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_rounds" DROP CONSTRAINT IF EXISTS "artboard_rounds_chosen_board_id_artboard_boards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_rounds" ADD CONSTRAINT "artboard_rounds_chosen_board_id_artboard_boards_id_fk" FOREIGN KEY ("chosen_board_id") REFERENCES "public"."artboard_boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_rounds" DROP CONSTRAINT IF EXISTS "artboard_rounds_selected_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_rounds" ADD CONSTRAINT "artboard_rounds_selected_by_users_id_fk" FOREIGN KEY ("selected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_acceptance_id_acceptances_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_boards_artboard_id_idx" ON "artboard_boards" USING btree ("artboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_boards_page_id_idx" ON "artboard_boards" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_boards_group_id_idx" ON "artboard_boards" USING btree ("group_id") WHERE "artboard_boards"."group_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_boards_round_id_idx" ON "artboard_boards" USING btree ("round_id") WHERE "artboard_boards"."round_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_boards_project_id_idx" ON "artboard_boards" USING btree ("project_id") WHERE "artboard_boards"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artboard_boards_acceptance_flow_node_id_unique" ON "artboard_boards" USING btree ("acceptance_flow_node_id") WHERE "artboard_boards"."acceptance_flow_node_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_boards_source_work_version_id_idx" ON "artboard_boards" USING btree ("source_work_version_id") WHERE "artboard_boards"."source_work_version_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_boards_user_id_idx" ON "artboard_boards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_boards_workspace_id_idx" ON "artboard_boards" USING btree ("workspace_id") WHERE "artboard_boards"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artboard_comments_artboard_id_author_user_id_client_id_unique" ON "artboard_comments" USING btree ("artboard_id","author_user_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_comments_artboard_id_created_at_idx" ON "artboard_comments" USING btree ("artboard_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_comments_parent_comment_id_idx" ON "artboard_comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_comments_board_id_idx" ON "artboard_comments" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_comments_user_id_idx" ON "artboard_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_comments_workspace_id_idx" ON "artboard_comments" USING btree ("workspace_id") WHERE "artboard_comments"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_comments_page_id_idx" ON "artboard_comments" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_comments_group_id_idx" ON "artboard_comments" USING btree ("group_id") WHERE "artboard_comments"."group_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_edges_artboard_id_idx" ON "artboard_edges" USING btree ("artboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_edges_source_board_id_idx" ON "artboard_edges" USING btree ("source_board_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artboard_edges_source_board_id_default_unique" ON "artboard_edges" USING btree ("source_board_id") WHERE "artboard_edges"."is_default" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_edges_target_board_id_idx" ON "artboard_edges" USING btree ("target_board_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artboard_edges_acceptance_flow_edge_id_unique" ON "artboard_edges" USING btree ("acceptance_flow_edge_id") WHERE "artboard_edges"."acceptance_flow_edge_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_edges_user_id_idx" ON "artboard_edges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_edges_workspace_id_idx" ON "artboard_edges" USING btree ("workspace_id") WHERE "artboard_edges"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_groups_artboard_id_idx" ON "artboard_groups" USING btree ("artboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_groups_page_id_idx" ON "artboard_groups" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_groups_user_id_idx" ON "artboard_groups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_groups_workspace_id_idx" ON "artboard_groups" USING btree ("workspace_id") WHERE "artboard_groups"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_pages_artboard_id_idx" ON "artboard_pages" USING btree ("artboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_pages_user_id_idx" ON "artboard_pages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_pages_workspace_id_idx" ON "artboard_pages" USING btree ("workspace_id") WHERE "artboard_pages"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_rounds_artboard_id_idx" ON "artboard_rounds" USING btree ("artboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_rounds_page_id_idx" ON "artboard_rounds" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_rounds_user_id_idx" ON "artboard_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_rounds_workspace_id_idx" ON "artboard_rounds" USING btree ("workspace_id") WHERE "artboard_rounds"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_rounds_recommended_board_id_idx" ON "artboard_rounds" USING btree ("recommended_board_id") WHERE "artboard_rounds"."recommended_board_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_rounds_chosen_board_id_idx" ON "artboard_rounds" USING btree ("chosen_board_id") WHERE "artboard_rounds"."chosen_board_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_user_id_idx" ON "artboards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_workspace_id_idx" ON "artboards" USING btree ("workspace_id") WHERE "artboards"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_topic_id_idx" ON "artboards" USING btree ("topic_id") WHERE "artboards"."topic_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_task_id_idx" ON "artboards" USING btree ("task_id") WHERE "artboards"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_project_id_idx" ON "artboards" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_phase_idx" ON "artboards" USING btree ("phase");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_created_at_idx" ON "artboards" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_updated_at_idx" ON "artboards" USING btree ("updated_at");