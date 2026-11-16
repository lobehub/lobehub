DROP INDEX IF EXISTS "channel_jobs_active_member_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "channel_jobs_active_directory_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_active_directory_idx" ON "channel_jobs" USING btree ("device_id","working_directory") WHERE "channel_jobs"."writer_held";