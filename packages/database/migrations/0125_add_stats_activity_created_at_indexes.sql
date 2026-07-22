-- Hot activity-source indexes.
--
-- On cloud production these indexes must be built online before deploy:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "agents_created_at_idx"
--   ON "agents" USING btree ("created_at");
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "topics_created_at_idx"
--   ON "topics" USING btree ("created_at");
--
-- The guarded statements below are then NO-OPs on databases that already have
-- the indexes, while fresh / self-hosted databases still converge to the target
-- schema during normal migration replay. Keep these statements non-CONCURRENTLY
-- so local PGlite / normal migration replay remains compatible.
CREATE INDEX IF NOT EXISTS "agents_created_at_idx" ON "agents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_created_at_idx" ON "topics" USING btree ("created_at");
