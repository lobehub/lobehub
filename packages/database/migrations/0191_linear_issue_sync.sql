CREATE TABLE IF NOT EXISTS "linear_sync_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"team_id" varchar(255) NOT NULL,
	"team_name" varchar(255) NOT NULL,
	"linear_project_id" varchar(255),
	"linear_project_name" varchar(255),
	"state_types" jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_result" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"external_identifier" varchar(255) NOT NULL,
	"external_url" text NOT NULL,
	"external_container_id" varchar(255),
	"external_updated_at" timestamp with time zone,
	"synced_hash" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linear_sync_rules" DROP CONSTRAINT IF EXISTS "linear_sync_rules_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "linear_sync_rules" ADD CONSTRAINT "linear_sync_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_sync_rules" DROP CONSTRAINT IF EXISTS "linear_sync_rules_connection_id_linear_connections_id_fk";--> statement-breakpoint
ALTER TABLE "linear_sync_rules" ADD CONSTRAINT "linear_sync_rules_connection_id_linear_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."linear_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_sync_rules" DROP CONSTRAINT IF EXISTS "linear_sync_rules_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "linear_sync_rules" ADD CONSTRAINT "linear_sync_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_sync_rules" DROP CONSTRAINT IF EXISTS "linear_sync_rules_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "linear_sync_rules" ADD CONSTRAINT "linear_sync_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_external_links" DROP CONSTRAINT IF EXISTS "task_external_links_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_external_links" ADD CONSTRAINT "task_external_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_external_links" DROP CONSTRAINT IF EXISTS "task_external_links_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_external_links" ADD CONSTRAINT "task_external_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_external_links" DROP CONSTRAINT IF EXISTS "task_external_links_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_external_links" ADD CONSTRAINT "task_external_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_sync_rules_project_id_idx" ON "linear_sync_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_sync_rules_connection_id_idx" ON "linear_sync_rules" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_sync_rules_user_id_idx" ON "linear_sync_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_sync_rules_workspace_id_idx" ON "linear_sync_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_external_links_task_id_unique" ON "task_external_links" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_external_links_personal_unique" ON "task_external_links" USING btree ("user_id","provider","external_id") WHERE "task_external_links"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_external_links_workspace_unique" ON "task_external_links" USING btree ("workspace_id","provider","external_id") WHERE "task_external_links"."workspace_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_external_links_container_idx" ON "task_external_links" USING btree ("provider","external_container_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_external_links_user_id_idx" ON "task_external_links" USING btree ("user_id");
