-- Workspace visibility for goals, mirroring agents / tasks. A constant default keeps the ADD COLUMN
-- metadata-only; goals is small (hundreds of rows), so the index builds inline. Existing goals that a
-- private agent supervises are privatized by hand after deploy.
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_workspace_visibility_idx" ON "goals" USING btree ("workspace_id","visibility","user_id");
