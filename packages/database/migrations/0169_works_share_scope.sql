ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "works_resource_user_scope_unique" ON "works" USING btree ("resource_type","resource_id","user_id",COALESCE((metadata -> 'agentShare' ->> 'topicId'), '')) WHERE "works"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "works_resource_workspace_scope_unique" ON "works" USING btree ("workspace_id","resource_type","resource_id",COALESCE((metadata -> 'agentShare' ->> 'topicId'), '')) WHERE "works"."workspace_id" is not null;--> statement-breakpoint
DROP INDEX IF EXISTS "works_resource_user_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "works_resource_workspace_unique";
