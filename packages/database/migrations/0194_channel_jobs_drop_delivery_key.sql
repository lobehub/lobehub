DROP INDEX IF EXISTS "channel_jobs_delivery_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_jobs_delivery_unique" ON "channel_jobs" USING btree ("message_id","member_id");--> statement-breakpoint
ALTER TABLE "channel_jobs" DROP COLUMN IF EXISTS "delivery_key";