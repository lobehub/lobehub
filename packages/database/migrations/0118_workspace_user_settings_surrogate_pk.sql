ALTER TABLE "workspace_user_settings" DROP CONSTRAINT IF EXISTS "workspace_user_settings_workspace_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "workspace_user_settings" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_user_settings_workspace_id_user_id_unique" ON "workspace_user_settings" USING btree ("workspace_id","user_id");
