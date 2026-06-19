-- verify_evidence: captured artifacts (screenshot / gif / video / text /
-- dom_snapshot / transcript) backing a verify_check_result. `parent_evidence_id`
-- self-references to form an evidence tree. All clauses are idempotent.

CREATE TABLE IF NOT EXISTS "verify_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_result_id" uuid NOT NULL,
	"type" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"byte_size" integer,
	"checksum" text,
	"captured_by" text,
	"captured_at" timestamp with time zone,
	"description" text,
	"parent_evidence_id" uuid,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_check_result_id_verify_check_results_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_check_result_id_verify_check_results_id_fk" FOREIGN KEY ("check_result_id") REFERENCES "public"."verify_check_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_parent_evidence_id_verify_evidence_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_parent_evidence_id_verify_evidence_id_fk" FOREIGN KEY ("parent_evidence_id") REFERENCES "public"."verify_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_check_result_id_idx" ON "verify_evidence" USING btree ("check_result_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_parent_evidence_id_idx" ON "verify_evidence" USING btree ("parent_evidence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_user_id_idx" ON "verify_evidence" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_workspace_id_idx" ON "verify_evidence" USING btree ("workspace_id");
