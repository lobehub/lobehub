ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "share_id" uuid;--> statement-breakpoint
-- Hot `topics` index.
--
-- On cloud production this index must be built online before deploy:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "topics_share_id_idx"
--   ON "topics" USING btree ("share_id");
--
-- A plain CREATE INDEX takes a lock that blocks every insert/update/delete on
-- `topics` for the length of a full-table scan, which on production would make
-- all conversation writes unavailable. The guarded statement below is then a
-- NO-OP on databases that already have the index, while fresh / self-hosted
-- databases still converge to the target schema during normal migration
-- replay. Keep this statement non-CONCURRENTLY so local PGlite / normal
-- migration replay stays compatible (same rollout pattern as 0116 / 0125).
CREATE INDEX IF NOT EXISTS "topics_share_id_idx" ON "topics" USING btree ("share_id");--> statement-breakpoint
-- Backfill: an existing agent-share visitor topic (`sender_id IS NOT NULL`)
-- predates this column and has no record of which `agent_shares` instance it
-- was created under. Best-effort assumption: it belongs to whatever share
-- row is CURRENTLY live for its agent — true unless that agent's share was
-- already disabled and re-enabled at least once before this migration ran,
-- a history this migration cannot reconstruct either way. This keeps
-- existing, never-recycled shares behaving exactly as before (their visitor
-- topics keep counting/listing normally) while an agent whose share is
-- currently disabled (no live `agent_shares` row to join) leaves its old
-- topics `share_id IS NULL` — which already correctly excludes them from
-- whatever NEW share instance a future re-enable creates, since a fresh
-- `agent_shares.id` can never equal NULL. See `topics.shareId`'s JSDoc
-- (`../src/schemas/topic.ts`) and LOBE-11930 codex P2.
--
-- Write volume is bounded: the `sender_id IS NOT NULL` predicate is served by
-- `topics_sender_id_idx` and matches only share-visitor topics, a small
-- fraction of the table — so unlike the index build above, this UPDATE does
-- not need an online rollout.
UPDATE "topics"
SET "share_id" = "agent_shares"."id"
FROM "agent_shares"
WHERE "topics"."sender_id" IS NOT NULL
  AND "topics"."share_id" IS NULL
  AND "agent_shares"."agent_id" = "topics"."agent_id";
