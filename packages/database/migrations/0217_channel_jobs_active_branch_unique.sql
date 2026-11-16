DROP INDEX IF EXISTS "channel_jobs_active_member_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_jobs_active_branch_unique" ON "channel_jobs" USING btree ("member_id",coalesce("thread_id", '')) WHERE "channel_jobs"."writer_held" AND "channel_jobs"."isolated_at" IS NULL;
