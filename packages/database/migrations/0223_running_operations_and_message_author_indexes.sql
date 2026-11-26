-- Indexes for two slow production scans on large tables:
-- - agent_operations_running_created_at_idx: StaleOperationReaper's `running` scans, which
--   otherwise read every `running` row through agent_operations_status_idx.
-- - messages_user_id_topic_id_idx: per-member message counts joined to topics (workspace usage
--   stats), which otherwise fetch every message the member ever wrote from the heap.
-- Create them on production with CREATE INDEX CONCURRENTLY before this migration ships, so this
-- no-ops there: drizzle runs a migration inside a transaction, where CONCURRENTLY is not allowed
-- and a plain CREATE INDEX would block writes to these tables for the whole build. Small databases
-- (self-hosted, preview, tests) just build them here.
CREATE INDEX IF NOT EXISTS "agent_operations_running_created_at_idx" ON "agent_operations" USING btree ("created_at") WHERE "agent_operations"."status" = 'running';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_user_id_topic_id_idx" ON "messages" USING btree ("user_id","topic_id");