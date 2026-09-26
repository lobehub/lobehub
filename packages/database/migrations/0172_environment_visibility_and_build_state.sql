ALTER TABLE "environments" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_instances" ADD COLUMN IF NOT EXISTS "build_id" text;--> statement-breakpoint
ALTER TABLE "environment_instances" ADD COLUMN IF NOT EXISTS "build_error" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "environments_workspace_visibility_idx" ON "environments" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_user_name_unique" ON "environments" USING btree ("user_id","name") WHERE "environments"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_workspace_user_name_unique" ON "environments" USING btree ("workspace_id","user_id","name") WHERE "environments"."workspace_id" is not null;
