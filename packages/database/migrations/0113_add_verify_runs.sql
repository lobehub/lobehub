-- Decouple the verify chain from agent_operations: introduce `verify_runs` (the
-- verification-session entity) and add `verify_run_id` to verify_check_results /
-- verify_reports as the new grouping key. Additive + non-destructive: `operation_id`
-- is KEPT (relaxed to nullable + ON DELETE set null) as a denormalized direct link
-- to the Agent Run, so no data is moved or dropped.

-- 1. The session entity. `operation_id` is an OPTIONAL link to an Agent Run
--    (null for standalone sessions); plan + rollup status live here now.
CREATE TABLE IF NOT EXISTS "verify_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"operation_id" text,
	"source" text DEFAULT 'agent' NOT NULL,
	"title" text,
	"goal" text,
	"plan" jsonb,
	"plan_confirmed_at" timestamp with time zone,
	"status" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verify_runs" DROP CONSTRAINT IF EXISTS "verify_runs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "verify_runs" ADD CONSTRAINT "verify_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_runs" DROP CONSTRAINT IF EXISTS "verify_runs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "verify_runs" ADD CONSTRAINT "verify_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_runs" DROP CONSTRAINT IF EXISTS "verify_runs_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "verify_runs" ADD CONSTRAINT "verify_runs_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_runs_user_id_idx" ON "verify_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_runs_workspace_id_idx" ON "verify_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verify_runs_operation_id_unique" ON "verify_runs" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_runs_source_idx" ON "verify_runs" USING btree ("source");--> statement-breakpoint

-- 2. Add the new run link (nullable, additive). The verify pipeline always sets it.
ALTER TABLE "verify_check_results" ADD COLUMN IF NOT EXISTS "verify_run_id" uuid;--> statement-breakpoint
ALTER TABLE "verify_reports" ADD COLUMN IF NOT EXISTS "verify_run_id" uuid;--> statement-breakpoint

-- 3. Keep operation_id, but relax it: nullable (standalone sessions have none) and
--    ON DELETE set null (the canonical run link is verify_runs, so a deleted op
--    must not cascade-delete verify data).
ALTER TABLE "verify_check_results" ALTER COLUMN "operation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_reports" DROP CONSTRAINT IF EXISTS "verify_reports_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "verify_reports" ADD CONSTRAINT "verify_reports_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- 4. The grouping unique key moves from operation_id onto verify_run_id.
DROP INDEX IF EXISTS "verify_check_results_operation_id_check_item_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "verify_reports_operation_id_unique";--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_verify_run_id_verify_runs_id_fk";--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_verify_run_id_verify_runs_id_fk" FOREIGN KEY ("verify_run_id") REFERENCES "public"."verify_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_reports" DROP CONSTRAINT IF EXISTS "verify_reports_verify_run_id_verify_runs_id_fk";--> statement-breakpoint
ALTER TABLE "verify_reports" ADD CONSTRAINT "verify_reports_verify_run_id_verify_runs_id_fk" FOREIGN KEY ("verify_run_id") REFERENCES "public"."verify_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_verify_run_id_idx" ON "verify_check_results" USING btree ("verify_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verify_check_results_verify_run_id_check_item_id_unique" ON "verify_check_results" USING btree ("verify_run_id","check_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verify_reports_verify_run_id_unique" ON "verify_reports" USING btree ("verify_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_reports_operation_id_idx" ON "verify_reports" USING btree ("operation_id");--> statement-breakpoint

-- 5. Backfill: the new readers address sessions via verify_runs (plan/status by
--    getStateByOperation, results/reports by verify_run_id), so existing
--    operation-keyed verification work must be lifted onto verify_runs or it
--    disappears after deploy. Mint exactly one run per operation that carries any
--    verify data (a plan/status on agent_operations, or results/reports keyed by
--    operation_id), copying its plan snapshot + rollup status and ownership.
--    Idempotent: ON CONFLICT keeps the unique operation_id, the relinks only fill
--    NULLs.
INSERT INTO "verify_runs" ("operation_id", "user_id", "workspace_id", "source", "plan", "plan_confirmed_at", "status")
SELECT o."id", o."user_id", o."workspace_id", 'agent', o."verify_plan", o."verify_plan_confirmed_at", o."verify_status"
FROM "agent_operations" o
WHERE o."verify_plan" IS NOT NULL
	OR o."verify_status" IS NOT NULL
	OR EXISTS (SELECT 1 FROM "verify_check_results" r WHERE r."operation_id" = o."id")
	OR EXISTS (SELECT 1 FROM "verify_reports" rep WHERE rep."operation_id" = o."id")
ON CONFLICT ("operation_id") DO NOTHING;--> statement-breakpoint

-- Relink the existing operation-keyed results / reports onto their new run.
UPDATE "verify_check_results" r
SET "verify_run_id" = vr."id"
FROM "verify_runs" vr
WHERE r."operation_id" = vr."operation_id" AND r."verify_run_id" IS NULL;--> statement-breakpoint
UPDATE "verify_reports" rep
SET "verify_run_id" = vr."id"
FROM "verify_runs" vr
WHERE rep."operation_id" = vr."operation_id" AND rep."verify_run_id" IS NULL;
