CREATE TABLE IF NOT EXISTS "acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requirement" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"visual_render" jsonb,
	"metadata" jsonb,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "acceptance_id" uuid;--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "round_index" integer;--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "user_decision" text;--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "decision_detail" jsonb;--> statement-breakpoint
ALTER TABLE "acceptances" DROP CONSTRAINT IF EXISTS "acceptances_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" DROP CONSTRAINT IF EXISTS "acceptances_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptances_user_id_idx" ON "acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptances_workspace_id_idx" ON "acceptances" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptances_subject_idx" ON "acceptances" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptances_status_idx" ON "acceptances" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptances_personal_subject_unique" ON "acceptances" USING btree ("user_id","subject_type","subject_id") WHERE "acceptances"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptances_workspace_subject_unique" ON "acceptances" USING btree ("workspace_id","subject_type","subject_id") WHERE "acceptances"."workspace_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "verify_runs" DROP CONSTRAINT IF EXISTS "verify_runs_acceptance_id_acceptances_id_fk";--> statement-breakpoint
ALTER TABLE "verify_runs" ADD CONSTRAINT "verify_runs_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_runs_acceptance_id_idx" ON "verify_runs" USING btree ("acceptance_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verify_runs_acceptance_round_unique" ON "verify_runs" USING btree ("acceptance_id","round_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_runs_user_decision_idx" ON "verify_runs" USING btree ("user_decision");--> statement-breakpoint
ALTER TABLE "verify_runs" DROP CONSTRAINT IF EXISTS "verify_runs_acceptance_requires_round";--> statement-breakpoint
ALTER TABLE "verify_runs" ADD CONSTRAINT "verify_runs_acceptance_requires_round" CHECK ("verify_runs"."acceptance_id" IS NULL OR "verify_runs"."round_index" IS NOT NULL);