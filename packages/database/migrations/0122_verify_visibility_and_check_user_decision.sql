ALTER TABLE "acceptances" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD COLUMN IF NOT EXISTS "user_decision_detail" jsonb;--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptances_workspace_visibility_idx" ON "acceptances" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
-- Backfill: workspace-scoped rows follow the workspace default (private);
-- personal rows keep the column default (public). Idempotent by nature.
UPDATE "acceptances" SET "visibility" = 'private' WHERE "workspace_id" IS NOT NULL;--> statement-breakpoint
UPDATE "verify_runs" SET "visibility" = 'private' WHERE "workspace_id" IS NOT NULL;
