ALTER TABLE "async_tasks" ADD COLUMN IF NOT EXISTS "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "async_tasks" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "async_tasks_parent_id_idx" ON "async_tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "async_tasks_type_status_idx" ON "async_tasks" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "async_tasks_metadata_idx" ON "async_tasks" USING gin ("metadata");
