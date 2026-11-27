-- topics.last_message_at: denormalized newest live-message `updated_at`, so the topic list orders
-- by COALESCE(last_message_at, updated_at) instead of a correlated `messages` subquery evaluated
-- for every topic of the agent before the top-N sort (30s for a 5.9k-topic agent on production).
-- The column is nullable and filled forward by the message write paths; historical rows are
-- backfilled out of band (scripts/backfillTopicLastMessageAt) — NULL falls back to updated_at.
--
-- The two list indexes: create them on production with CREATE INDEX CONCURRENTLY (same
-- definitions) before this migration ships, so these statements no-op there; drizzle runs
-- migrations inside a transaction, where CONCURRENTLY is not allowed and a plain CREATE INDEX
-- would block writes to topics for the whole build. Small databases just build them here.
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "last_message_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_user_id_agent_id_activity_idx" ON "topics" USING btree ("user_id","agent_id","favorite",COALESCE("last_message_at", "updated_at")) WHERE "topics"."workspace_id" IS NULL AND "topics"."is_deleted" IS NOT TRUE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_workspace_id_agent_id_activity_idx" ON "topics" USING btree ("workspace_id","agent_id","favorite",COALESCE("last_message_at", "updated_at")) WHERE "topics"."workspace_id" IS NOT NULL AND "topics"."is_deleted" IS NOT TRUE;
