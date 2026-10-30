-- Indexes on the new columns of the existing large user_memories* tables (added in 0195).
-- Create them on production with CREATE INDEX CONCURRENTLY before this migration ships, so this
-- no-ops there: drizzle runs a migration inside a transaction, where CONCURRENTLY is not allowed
-- and a plain CREATE INDEX would block writes to these tables for the whole build. Small databases
-- (self-hosted, preview, tests) just build them here.
CREATE INDEX IF NOT EXISTS "user_memories_activities_dossier_id_index" ON "user_memories_activities" USING btree ("dossier_id") WHERE "user_memories_activities"."dossier_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_contexts_user_memory_id_index" ON "user_memories_contexts" USING btree ("user_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_contexts_user_id_last_evidence_at_index" ON "user_memories_contexts" USING btree ("user_id","last_evidence_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_identities_entity_id_index" ON "user_memories_identities" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_preferences_holder_entity_id_index" ON "user_memories_preferences" USING btree ("holder_entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_preferences_applies_to_entity_id_index" ON "user_memories_preferences" USING btree ("applies_to_entity_id");
