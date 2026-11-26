DROP INDEX IF EXISTS "environments_user_name_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "environments_workspace_user_name_unique";--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint
ALTER TABLE "environments" DROP CONSTRAINT IF EXISTS "environments_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_project_id_unique" ON "environments" USING btree ("project_id") WHERE "environments"."project_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_user_name_unique" ON "environments" USING btree ("user_id","name") WHERE "environments"."workspace_id" IS NULL AND "environments"."project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_workspace_user_name_unique" ON "environments" USING btree ("workspace_id","user_id","name") WHERE "environments"."workspace_id" IS NOT NULL AND "environments"."project_id" IS NULL;