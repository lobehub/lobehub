CREATE TABLE IF NOT EXISTS "project_working_directories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"device_id" uuid,
	"workspace_id" text,
	"added_by_user_id" text,
	"path" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"permission" text DEFAULT 'readWrite' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_working_directories_path_not_empty" CHECK (length(btrim("project_working_directories"."path")) > 0),
	CONSTRAINT "project_working_directories_name_not_empty" CHECK (length(btrim("project_working_directories"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "project_working_directory_id" uuid;--> statement-breakpoint
ALTER TABLE "project_working_directories" DROP CONSTRAINT IF EXISTS "project_working_directories_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_working_directories" ADD CONSTRAINT "project_working_directories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_working_directories" DROP CONSTRAINT IF EXISTS "project_working_directories_device_id_devices_id_fk";--> statement-breakpoint
ALTER TABLE "project_working_directories" ADD CONSTRAINT "project_working_directories_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_working_directories" DROP CONSTRAINT IF EXISTS "project_working_directories_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "project_working_directories" ADD CONSTRAINT "project_working_directories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_working_directories" DROP CONSTRAINT IF EXISTS "project_working_directories_added_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_working_directories" ADD CONSTRAINT "project_working_directories_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_working_directories_project_device_path_unique" ON "project_working_directories" USING btree ("project_id","device_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_working_directories_project_primary_unique" ON "project_working_directories" USING btree ("project_id") WHERE "project_working_directories"."is_primary" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_working_directories_project_sort_order_idx" ON "project_working_directories" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_working_directories_device_id_idx" ON "project_working_directories" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_working_directories_workspace_id_idx" ON "project_working_directories" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_project_working_directory_id_project_working_directories_id_fk";--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_project_working_directory_id_project_working_directories_id_fk" FOREIGN KEY ("project_working_directory_id") REFERENCES "public"."project_working_directories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_project_id_idx" ON "topics" USING btree ("project_id") WHERE "topics"."project_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_project_working_directory_id_idx" ON "topics" USING btree ("project_working_directory_id") WHERE "topics"."project_working_directory_id" is not null;
