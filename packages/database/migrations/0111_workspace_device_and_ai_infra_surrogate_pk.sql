-- Combined workspace-scoped DB rollout (formerly two separate 0111 migrations):
--   1. ai_infra surrogate `_id` PK + workspace-scoped partial uniques (LOBE-10056)
--   2. workspace-scoped device unique + workspace `frozen` columns (LOBE-10315)
--
-- The two parts touch disjoint tables (ai_providers / ai_models vs.
-- devices / workspaces). Every statement is guarded so the migration is a
-- NO-OP on databases that already have the shape (cloud production, where the
-- ai_infra side was applied online via manual steps) and a full rebuild on
-- fresh / self-hosted databases.

-- ===========================================================================
-- Part 1 — ai_infra surrogate `_id` PK + workspace-scoped partial uniques
-- (LOBE-10056 Phase 5)
--
-- On cloud production this whole part is a NO-OP: the manual steps [3]~[7]
-- (LOBE-10073 .. LOBE-10077) already performed the backfill, NOT NULL, PK swap
-- and partial indexes online / CONCURRENTLY. Every statement below is guarded
-- (UPDATE … WHERE _id IS NULL / IF EXISTS / catalog check / IF NOT EXISTS) so
-- it skips cleanly there, while still fully rebuilding the schema on a fresh or
-- self-hosted database (where [3]~[7] never ran).
-- ===========================================================================

-- 1) backfill rows still missing _id (no-op on prod; fills self-host history) --
UPDATE "ai_providers" SET "_id" = gen_random_uuid() WHERE "_id" IS NULL;--> statement-breakpoint
UPDATE "ai_models" SET "_id" = gen_random_uuid() WHERE "_id" IS NULL;--> statement-breakpoint

-- 2) enforce NOT NULL (no-op if already set) --
ALTER TABLE "ai_providers" ALTER COLUMN "_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ALTER COLUMN "_id" SET NOT NULL;--> statement-breakpoint

-- 3) drop old composite PKs (no-op on prod, already dropped in [7]) --
ALTER TABLE "ai_providers" DROP CONSTRAINT IF EXISTS "ai_providers_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_id_provider_id_user_id_pk";--> statement-breakpoint

-- 4) promote _id to PK only when the table has no PK yet
--    (Postgres has no `ADD PRIMARY KEY IF NOT EXISTS`; guard via pg_constraint) --
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_providers'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("_id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_models'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_pkey" PRIMARY KEY ("_id");
  END IF;
END $$;--> statement-breakpoint

-- 5) workspace-scoped partial unique indexes (no-op on prod, already built in [6]) --
CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_id_user_id_unique" ON "ai_providers" USING btree ("id","user_id") WHERE "workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_providers_id_user_id_workspace_id_unique" ON "ai_providers" USING btree ("id","user_id","workspace_id") WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_id_provider_id_user_id_unique" ON "ai_models" USING btree ("id","provider_id","user_id") WHERE "workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_models_id_provider_id_user_id_workspace_id_unique" ON "ai_models" USING btree ("id","provider_id","user_id","workspace_id") WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint

-- ===========================================================================
-- Part 2 — workspace-scoped device unique + workspace `frozen` columns
-- (LOBE-10315)
--
-- Replace the full (user_id, device_id) unique with two partial uniques scoped
-- by workspace_id (null vs. not null), so personal and workspace-enrolled rows
-- live in independent identity spaces. Also add the workspace freeze trio
-- (mirrors users.banned) backing cloud workspace-freeze risk control.
-- ===========================================================================

DROP INDEX IF EXISTS "devices_user_id_device_id_unique";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen_reason" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_workspace_id_device_id_unique" ON "devices" USING btree ("workspace_id","device_id") WHERE "devices"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_user_id_device_id_unique" ON "devices" USING btree ("user_id","device_id") WHERE "devices"."workspace_id" IS NULL;
