CREATE TABLE IF NOT EXISTS "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"name" varchar(255) NOT NULL,
	"description" text,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb NOT NULL,
	"configuration_version" integer DEFAULT 1 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_name_not_empty" CHECK (length(btrim("environments"."name")) > 0),
	CONSTRAINT "environments_provider_not_empty" CHECK (length(btrim("environments"."provider")) > 0),
	CONSTRAINT "environments_configuration_version_positive" CHECK ("environments"."configuration_version" > 0),
	CONSTRAINT "environments_configuration_object" CHECK (jsonb_typeof("environments"."configuration") = 'object')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" uuid NOT NULL,
	"workspace_id" text,
	"added_by_user_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_environments_default_enabled" CHECK (NOT "project_environments"."is_default" OR "project_environments"."enabled")
);
--> statement-breakpoint
ALTER TABLE "environments" DROP CONSTRAINT IF EXISTS "environments_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" DROP CONSTRAINT IF EXISTS "environments_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_environments" DROP CONSTRAINT IF EXISTS "project_environments_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_environments" DROP CONSTRAINT IF EXISTS "project_environments_environment_id_environments_id_fk";
--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_environments" DROP CONSTRAINT IF EXISTS "project_environments_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_environments" DROP CONSTRAINT IF EXISTS "project_environments_added_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environments_user_id_idx" ON "environments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environments_workspace_id_idx" ON "environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_environments_project_environment_unique" ON "project_environments" USING btree ("project_id","environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_environments_project_default_unique" ON "project_environments" USING btree ("project_id") WHERE "project_environments"."is_default" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_project_sort_order_idx" ON "project_environments" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_environment_id_idx" ON "project_environments" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_workspace_id_idx" ON "project_environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_added_by_user_id_idx" ON "project_environments" USING btree ("added_by_user_id");