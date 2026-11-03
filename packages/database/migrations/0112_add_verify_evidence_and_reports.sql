CREATE TABLE IF NOT EXISTS "verify_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"description" text,
	"check_result_id" uuid NOT NULL,
	"type" text NOT NULL,
	"content" text,
	"file_id" text,
	"captured_by" text,
	"captured_at" timestamp with time zone,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verify_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"verdict" text,
	"overall_confidence" numeric(3, 2),
	"total_checks" integer,
	"passed_checks" integer,
	"failed_checks" integer,
	"uncertain_checks" integer,
	"summary" text,
	"content" text,
	"reviewed_by_user" boolean DEFAULT false,
	"generated_by" text DEFAULT 'system',
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_check_result_id_verify_check_results_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_check_result_id_verify_check_results_id_fk" FOREIGN KEY ("check_result_id") REFERENCES "public"."verify_check_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_reports" DROP CONSTRAINT IF EXISTS "verify_reports_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "verify_reports" ADD CONSTRAINT "verify_reports_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_reports" DROP CONSTRAINT IF EXISTS "verify_reports_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "verify_reports" ADD CONSTRAINT "verify_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_reports" DROP CONSTRAINT IF EXISTS "verify_reports_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "verify_reports" ADD CONSTRAINT "verify_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_check_result_id_idx" ON "verify_evidence" USING btree ("check_result_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_file_id_idx" ON "verify_evidence" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_user_id_idx" ON "verify_evidence" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_workspace_id_idx" ON "verify_evidence" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verify_reports_operation_id_unique" ON "verify_reports" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_reports_user_id_idx" ON "verify_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_reports_workspace_id_idx" ON "verify_reports" USING btree ("workspace_id");
