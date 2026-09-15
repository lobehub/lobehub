DROP INDEX IF EXISTS "resource_permissions_workspace_resource_unique";--> statement-breakpoint
ALTER TABLE "resource_permissions" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "resource_permissions" DROP CONSTRAINT IF EXISTS "resource_permissions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "resource_permissions" ADD CONSTRAINT "resource_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_permissions_workspace_resource_user_id_unique" ON "resource_permissions" USING btree ("workspace_id","resource_type","resource_id","user_id") WHERE "resource_permissions"."user_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_permissions_workspace_user_idx" ON "resource_permissions" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_permissions_workspace_resource_unique" ON "resource_permissions" USING btree ("workspace_id","resource_type","resource_id") WHERE "resource_permissions"."user_id" is null;
