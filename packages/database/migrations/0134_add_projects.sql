CREATE TABLE IF NOT EXISTS "project_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"role" text,
	"responsibility" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_chat_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"chat_group_id" text NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"role" text,
	"responsibility" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_completion_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"reviewer_user_id" text,
	"workspace_id" text,
	"round" integer NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_completion_reviews_round_positive" CHECK ("project_completion_reviews"."round" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_knowledge_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(100),
	"name" varchar(255) NOT NULL,
	"description" text,
	"avatar" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"completed_review_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_completed_requires_human_review" CHECK ("projects"."status" <> 'completed' OR ("projects"."completed_review_id" IS NOT NULL AND "projects"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint
ALTER TABLE "project_agents" DROP CONSTRAINT IF EXISTS "project_agents_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agents" DROP CONSTRAINT IF EXISTS "project_agents_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agents" DROP CONSTRAINT IF EXISTS "project_agents_added_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agents" DROP CONSTRAINT IF EXISTS "project_agents_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chat_groups" DROP CONSTRAINT IF EXISTS "project_chat_groups_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_chat_groups" ADD CONSTRAINT "project_chat_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chat_groups" DROP CONSTRAINT IF EXISTS "project_chat_groups_chat_group_id_chat_groups_id_fk";--> statement-breakpoint
ALTER TABLE "project_chat_groups" ADD CONSTRAINT "project_chat_groups_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chat_groups" DROP CONSTRAINT IF EXISTS "project_chat_groups_added_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_chat_groups" ADD CONSTRAINT "project_chat_groups_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_chat_groups" DROP CONSTRAINT IF EXISTS "project_chat_groups_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "project_chat_groups" ADD CONSTRAINT "project_chat_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_completion_reviews" DROP CONSTRAINT IF EXISTS "project_completion_reviews_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_completion_reviews" ADD CONSTRAINT "project_completion_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_completion_reviews" DROP CONSTRAINT IF EXISTS "project_completion_reviews_reviewer_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_completion_reviews" ADD CONSTRAINT "project_completion_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_completion_reviews" DROP CONSTRAINT IF EXISTS "project_completion_reviews_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "project_completion_reviews" ADD CONSTRAINT "project_completion_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_bases" DROP CONSTRAINT IF EXISTS "project_knowledge_bases_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_knowledge_bases" ADD CONSTRAINT "project_knowledge_bases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_bases" DROP CONSTRAINT IF EXISTS "project_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk";--> statement-breakpoint
ALTER TABLE "project_knowledge_bases" ADD CONSTRAINT "project_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_bases" DROP CONSTRAINT IF EXISTS "project_knowledge_bases_added_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_knowledge_bases" ADD CONSTRAINT "project_knowledge_bases_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_bases" DROP CONSTRAINT IF EXISTS "project_knowledge_bases_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "project_knowledge_bases" ADD CONSTRAINT "project_knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_agents_project_id_agent_id_unique" ON "project_agents" USING btree ("project_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_agents_project_id_sort_order_idx" ON "project_agents" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_agents_agent_id_idx" ON "project_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_agents_workspace_id_idx" ON "project_agents" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_chat_groups_project_id_chat_group_id_unique" ON "project_chat_groups" USING btree ("project_id","chat_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_chat_groups_project_id_sort_order_idx" ON "project_chat_groups" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_chat_groups_chat_group_id_idx" ON "project_chat_groups" USING btree ("chat_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_chat_groups_workspace_id_idx" ON "project_chat_groups" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_completion_reviews_project_id_round_unique" ON "project_completion_reviews" USING btree ("project_id","round");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_completion_reviews_project_id_created_at_idx" ON "project_completion_reviews" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_completion_reviews_reviewer_user_id_idx" ON "project_completion_reviews" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_completion_reviews_workspace_id_idx" ON "project_completion_reviews" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_knowledge_bases_project_id_knowledge_base_id_unique" ON "project_knowledge_bases" USING btree ("project_id","knowledge_base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_knowledge_bases_project_id_sort_order_idx" ON "project_knowledge_bases" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_knowledge_bases_knowledge_base_id_idx" ON "project_knowledge_bases" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_knowledge_bases_workspace_id_idx" ON "project_knowledge_bases" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_slug_user_id_unique" ON "projects" USING btree ("slug","user_id") WHERE "projects"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_slug_workspace_id_unique" ON "projects" USING btree ("workspace_id","slug") WHERE "projects"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_workspace_id_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_workspace_visibility_idx" ON "projects" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_status_updated_at_idx" ON "projects" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_id_status_idx" ON "tasks" USING btree ("project_id","status");
