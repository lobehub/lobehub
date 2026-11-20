-- Archive marker for goals, mirroring tasks.archived_at: nullable with no default, so the
-- ADD COLUMN is metadata-only.
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
