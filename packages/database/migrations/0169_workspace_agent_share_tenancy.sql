ALTER TABLE "agent_shares" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "agent_share_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_shares" DROP CONSTRAINT IF EXISTS "agent_shares_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_agent_share_id_agent_shares_id_fk";--> statement-breakpoint
-- Avoid the blocking validation scan while installing the FK on the active
-- topics table. New writes are checked immediately; existing rows are
-- validated after the legacy cleanup below. Null rollout-era rows remain valid
-- and are reconciled later by the bounded backfill script.
ALTER TABLE "topics" ADD CONSTRAINT "topics_agent_share_id_agent_shares_id_fk" FOREIGN KEY ("agent_share_id") REFERENCES "public"."agent_shares"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
-- Historical visitor topics are reconciled after deploy by the bounded,
-- resumable scripts/backfillAgentShareTopics.ts job. New application writes
-- always set agent_share_id, while transitional reads also recognize null rows
-- that belong to the current share instance.
-- A same-owner personal -> Workspace transfer was historically allowed to
-- leave a share with the old personal scope. Do not copy the Agent's new
-- workspace_id onto that row: doing so would silently reactivate the old
-- link. Revoke the scope-mismatched share instead; the FK cascade removes
-- visitor topics that were associated with it above, and the agentId unique
-- index then allows a fresh share to be created in the target scope.
--
-- Visitor file provenance is metadata-only, so the share/topic cascades do not
-- reach either the files row or its object. Queue every affected object through
-- the existing durable upload sweeper before removing those rows. A fresh
-- cleanup session is required because settled upload sessions are retained for
-- only seven days and may no longer exist for an older share.
WITH "affected_files" AS MATERIALIZED (
  SELECT
    "file"."id",
    "file"."user_id",
    "file"."workspace_id",
    "file"."url",
    "file"."size"
  FROM "files" AS "file"
  INNER JOIN "agent_shares" AS "share"
    ON "file"."metadata" -> 'agentShare' ->> 'shareId' = "share"."id"::text
  INNER JOIN "agents" AS "agent" ON "share"."agent_id" = "agent"."id"
  WHERE "share"."workspace_id" IS DISTINCT FROM "agent"."workspace_id"
), "queued_cleanup" AS (
  INSERT INTO "file_uploads" (
    "user_id",
    "workspace_id",
    "pathname",
    "size",
    "status",
    "expires_at"
  )
  SELECT
    "affected"."user_id",
    "affected"."workspace_id",
    "affected"."url",
    "affected"."size",
    'active',
    now()
  FROM "affected_files" AS "affected"
  ON CONFLICT ("pathname") WHERE "status" IN ('active', 'cleaning')
  DO UPDATE SET
    "file_id" = NULL,
    "status" = 'active',
    "expires_at" = now(),
    "updated_at" = now()
  RETURNING 1
)
DELETE FROM "files" AS "file"
USING "affected_files" AS "affected"
WHERE "file"."id" = "affected"."id"
  AND (SELECT count(*) FROM "queued_cleanup") >= 0;--> statement-breakpoint
-- Old rolling-deploy writers did not have agent_share_id, so these rows are
-- not covered by the FK cascade when a scope-mismatched share is revoked.
DELETE FROM "topics" AS "topic"
USING "agent_shares" AS "share", "agents" AS "agent"
WHERE "topic"."agent_id" = "share"."agent_id"
  AND "share"."agent_id" = "agent"."id"
  AND "share"."workspace_id" IS DISTINCT FROM "agent"."workspace_id"
  AND "topic"."sender_id" IS NOT NULL
  AND "topic"."agent_share_id" IS NULL;--> statement-breakpoint
DELETE FROM "agent_shares" AS "share"
USING "agents" AS "agent"
WHERE "share"."agent_id" = "agent"."id"
  AND "share"."workspace_id" IS DISTINCT FROM "agent"."workspace_id";--> statement-breakpoint
ALTER TABLE "topics" VALIDATE CONSTRAINT "topics_agent_share_id_agent_shares_id_fk";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_shares_workspace_id_idx" ON "agent_shares" USING btree ("workspace_id");--> statement-breakpoint
-- Hot index on the large topics table.
--
-- On cloud production, build it online before deploy:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "topics_agent_share_sender_id_idx"
--   ON "topics" USING btree ("agent_share_id","sender_id")
--   WHERE "topics"."agent_share_id" IS NOT NULL;
--
-- Keep the guarded statement below non-CONCURRENTLY so local PGlite / normal
-- migration replay remains compatible.
CREATE INDEX IF NOT EXISTS "topics_agent_share_sender_id_idx" ON "topics" USING btree ("agent_share_id","sender_id") WHERE "topics"."agent_share_id" is not null;
