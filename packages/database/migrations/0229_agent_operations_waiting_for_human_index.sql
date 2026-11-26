-- agent_operations_waiting_for_human_created_at_idx: ParkedInterventionExpiry's scan of runs parked
-- on a human answer, which otherwise reads every `waiting_for_human` row through
-- agent_operations_status_idx (~92k buffers per sweep on a 3.6M-row dev copy, 0.2-4s).
-- Create it on production with CREATE INDEX CONCURRENTLY before this migration ships, so this
-- no-ops there: drizzle runs a migration inside a transaction, where CONCURRENTLY is not allowed
-- and a plain CREATE INDEX would block writes to agent_operations for the whole build (32s on the
-- dev copy). Small databases (self-hosted, preview, tests) just build it here.
CREATE INDEX IF NOT EXISTS "agent_operations_waiting_for_human_created_at_idx" ON "agent_operations" USING btree ("created_at") WHERE "agent_operations"."status" = 'waiting_for_human';
