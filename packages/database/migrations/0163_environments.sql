CREATE TABLE IF NOT EXISTS "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"name" varchar(255) NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_name_not_empty" CHECK (length(btrim("environments"."name")) > 0),
	CONSTRAINT "environments_configuration_object" CHECK (jsonb_typeof("environments"."configuration") = 'object')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "environment_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" text NOT NULL,
	"device_id" uuid,
	"provider" text,
	"provider_scope" text,
	"provider_resource_id" text,
	"working_directory" text NOT NULL,
	"configuration_snapshot" jsonb NOT NULL,
	"configuration" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_instances_name_not_empty" CHECK (length(btrim("environment_instances"."name")) > 0),
	CONSTRAINT "environment_instances_directory_not_empty" CHECK (length(btrim("environment_instances"."working_directory")) > 0),
	CONSTRAINT "environment_instances_snapshot_object" CHECK (jsonb_typeof("environment_instances"."configuration_snapshot") = 'object'),
	CONSTRAINT "environment_instances_configuration_object" CHECK ("environment_instances"."configuration" IS NULL OR jsonb_typeof("environment_instances"."configuration") = 'object'),
	CONSTRAINT "environment_instances_binding" CHECK ((
    "environment_instances"."kind" = 'device' AND "environment_instances"."device_id" IS NOT NULL AND "environment_instances"."provider" IS NULL AND "environment_instances"."provider_scope" IS NULL AND "environment_instances"."provider_resource_id" IS NULL
  ) OR (
    "environment_instances"."kind" <> 'device' AND "environment_instances"."device_id" IS NULL AND
    "environment_instances"."provider" IS NOT NULL AND length(btrim("environment_instances"."provider")) > 0 AND
    "environment_instances"."provider_scope" IS NOT NULL AND length(btrim("environment_instances"."provider_scope")) > 0 AND
    "environment_instances"."provider_resource_id" IS NOT NULL AND length(btrim("environment_instances"."provider_resource_id")) > 0
  ))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" uuid NOT NULL,
	"workspace_id" text,
	"added_by_user_id" text,
	"default_instance_id" uuid,
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
ALTER TABLE "environment_instances" DROP CONSTRAINT IF EXISTS "environment_instances_environment_id_environments_id_fk";
--> statement-breakpoint
ALTER TABLE "environment_instances" ADD CONSTRAINT "environment_instances_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_instances" DROP CONSTRAINT IF EXISTS "environment_instances_device_id_devices_id_fk";
--> statement-breakpoint
ALTER TABLE "environment_instances" ADD CONSTRAINT "environment_instances_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
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
CREATE UNIQUE INDEX IF NOT EXISTS "environment_instances_environment_id_id_unique" ON "environment_instances" USING btree ("environment_id","id");--> statement-breakpoint
ALTER TABLE "project_environments" DROP CONSTRAINT IF EXISTS "project_environments_default_instance_fk";
--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_default_instance_fk" FOREIGN KEY ("environment_id","default_instance_id") REFERENCES "public"."environment_instances"("environment_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environments_user_id_idx" ON "environments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environments_workspace_id_idx" ON "environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environment_instances_device_path_unique" ON "environment_instances" USING btree ("device_id","working_directory") WHERE "environment_instances"."device_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environment_instances_provider_path_unique" ON "environment_instances" USING btree ("kind","provider","provider_scope","provider_resource_id","working_directory") WHERE "environment_instances"."device_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environment_instances_environment_id_idx" ON "environment_instances" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_default_instance_id_idx" ON "project_environments" USING btree ("default_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_environments_project_environment_unique" ON "project_environments" USING btree ("project_id","environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_environments_project_default_unique" ON "project_environments" USING btree ("project_id") WHERE "project_environments"."is_default" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_project_sort_order_idx" ON "project_environments" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_environment_id_idx" ON "project_environments" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_workspace_id_idx" ON "project_environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_environments_added_by_user_id_idx" ON "project_environments" USING btree ("added_by_user_id");