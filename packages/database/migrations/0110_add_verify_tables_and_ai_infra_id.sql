CREATE TABLE IF NOT EXISTS "verify_check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"check_item_id" text NOT NULL,
	"check_item_title" text,
	"required" boolean DEFAULT true NOT NULL,
	"check_item_index" integer,
	"verifier_type" text NOT NULL,
	"verifier_config_hash" text,
	"verifier_operation_id" text,
	"verifier_tracing_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"verdict" text,
	"confidence" numeric(3, 2),
	"toulmin" jsonb,
	"suggestion" text,
	"user_decision" text,
	"is_false_positive" boolean,
	"is_false_negative" boolean,
	"repair_operation_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verify_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"required" boolean DEFAULT true NOT NULL,
	"verifier_type" text NOT NULL,
	"verifier_config" jsonb DEFAULT '{}'::jsonb,
	"on_fail" text DEFAULT 'manual' NOT NULL,
	"document_id" varchar(255),
	"workspace_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verify_rubric_criteria" (
	"rubric_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verify_rubric_criteria_rubric_id_criterion_id_pk" PRIMARY KEY("rubric_id","criterion_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verify_rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"workspace_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "verify_status" text;
--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "verify_plan" jsonb;
--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "verify_plan_confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_verifier_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_verifier_operation_id_agent_operations_id_fk" FOREIGN KEY ("verifier_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_verifier_tracing_id_llm_generation_tracing_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_verifier_tracing_id_llm_generation_tracing_id_fk" FOREIGN KEY ("verifier_tracing_id") REFERENCES "public"."llm_generation_tracing"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_repair_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_repair_operation_id_agent_operations_id_fk" FOREIGN KEY ("repair_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_criteria" DROP CONSTRAINT IF EXISTS "verify_criteria_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD CONSTRAINT "verify_criteria_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_criteria" DROP CONSTRAINT IF EXISTS "verify_criteria_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD CONSTRAINT "verify_criteria_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_criteria" DROP CONSTRAINT IF EXISTS "verify_criteria_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD CONSTRAINT "verify_criteria_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_rubric_criteria" DROP CONSTRAINT IF EXISTS "verify_rubric_criteria_rubric_id_verify_rubrics_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_rubric_criteria" ADD CONSTRAINT "verify_rubric_criteria_rubric_id_verify_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."verify_rubrics"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_rubric_criteria" DROP CONSTRAINT IF EXISTS "verify_rubric_criteria_criterion_id_verify_criteria_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_rubric_criteria" ADD CONSTRAINT "verify_rubric_criteria_criterion_id_verify_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."verify_criteria"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_rubric_criteria" DROP CONSTRAINT IF EXISTS "verify_rubric_criteria_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_rubric_criteria" ADD CONSTRAINT "verify_rubric_criteria_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_rubric_criteria" DROP CONSTRAINT IF EXISTS "verify_rubric_criteria_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_rubric_criteria" ADD CONSTRAINT "verify_rubric_criteria_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_rubrics" DROP CONSTRAINT IF EXISTS "verify_rubrics_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_rubrics" ADD CONSTRAINT "verify_rubrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "verify_rubrics" DROP CONSTRAINT IF EXISTS "verify_rubrics_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_rubrics" ADD CONSTRAINT "verify_rubrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_operation_id_idx" ON "verify_check_results" USING btree ("operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_user_id_idx" ON "verify_check_results" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verify_check_results_operation_id_check_item_id_unique" ON "verify_check_results" USING btree ("operation_id","check_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_verifier_type_idx" ON "verify_check_results" USING btree ("verifier_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_verifier_operation_id_idx" ON "verify_check_results" USING btree ("verifier_operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_verifier_tracing_id_idx" ON "verify_check_results" USING btree ("verifier_tracing_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_status_idx" ON "verify_check_results" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_verdict_idx" ON "verify_check_results" USING btree ("verdict");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_repair_operation_id_idx" ON "verify_check_results" USING btree ("repair_operation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_workspace_id_idx" ON "verify_check_results" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_criteria_user_id_idx" ON "verify_criteria" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_criteria_verifier_type_idx" ON "verify_criteria" USING btree ("verifier_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_criteria_document_id_idx" ON "verify_criteria" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_criteria_workspace_id_idx" ON "verify_criteria" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_rubric_criteria_criterion_id_idx" ON "verify_rubric_criteria" USING btree ("criterion_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_rubric_criteria_user_id_idx" ON "verify_rubric_criteria" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_rubric_criteria_workspace_id_idx" ON "verify_rubric_criteria" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_rubrics_user_id_idx" ON "verify_rubrics" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_rubrics_workspace_id_idx" ON "verify_rubrics" USING btree ("workspace_id");
--> statement-breakpoint
-- LOBE-10072: nullable surrogate `_id` for the online workspace-scoped rebuild
-- (LOBE-10056). Two-step (ADD nullable, then SET DEFAULT) so it stays catalog-only
-- — a combined volatile-DEFAULT ADD COLUMN would rewrite the whole table under lock.
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "_id" uuid;
--> statement-breakpoint
ALTER TABLE "ai_providers" ALTER COLUMN "_id" SET DEFAULT gen_random_uuid();
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "_id" uuid;
--> statement-breakpoint
ALTER TABLE "ai_models" ALTER COLUMN "_id" SET DEFAULT gen_random_uuid();
