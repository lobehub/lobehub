DROP INDEX IF EXISTS "channel_jobs_active_member_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "channel_jobs_active_directory_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_active_directory_idx" ON "channel_jobs" USING btree ("device_id","working_directory") WHERE "channel_jobs"."writer_held";--> statement-breakpoint
ALTER TABLE "channel_messages" DROP CONSTRAINT IF EXISTS "channel_messages_agent_sender_check";--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "agent_pair_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_agent_pair_unique" ON "channels" USING btree ("agent_pair_key","user_id",coalesce("workspace_id", '')) WHERE "channels"."agent_pair_key" IS NOT NULL;
