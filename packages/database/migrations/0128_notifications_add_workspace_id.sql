ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_workspace" ON "notifications" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_workspace_id" ON "notifications" USING btree ("workspace_id");
