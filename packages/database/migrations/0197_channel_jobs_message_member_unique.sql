-- Keep delivery_key and its default for older binaries during the rolling upgrade.
-- The ORM snapshot intentionally omits it; drop it only in a later custom migration
-- after all old instances, workers and in-flight tasks have drained.
DROP INDEX IF EXISTS "channel_jobs_delivery_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_jobs_delivery_unique" ON "channel_jobs" USING btree ("message_id","member_id");
