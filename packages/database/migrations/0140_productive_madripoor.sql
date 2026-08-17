CREATE TABLE IF NOT EXISTS "verify_review_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_result_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text NOT NULL,
	"action" text,
	"status_reason" text,
	"confidence" numeric(3, 2),
	"comment" text,
	"rationale" text,
	"annotations" jsonb,
	"adjudication" text,
	"adjudication_edit" text,
	"adjudicated_at" timestamp with time zone,
	"latency_ms" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verify_review_predictions_action_matches_status" CHECK (("verify_review_predictions"."status" = 'judged') = ("verify_review_predictions"."action" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "verify_review_predictions" DROP CONSTRAINT IF EXISTS "verify_review_predictions_check_result_id_verify_check_results_id_fk";--> statement-breakpoint
ALTER TABLE "verify_review_predictions" ADD CONSTRAINT "verify_review_predictions_check_result_id_verify_check_results_id_fk" FOREIGN KEY ("check_result_id") REFERENCES "public"."verify_check_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_review_predictions" DROP CONSTRAINT IF EXISTS "verify_review_predictions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "verify_review_predictions" ADD CONSTRAINT "verify_review_predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verify_review_predictions" DROP CONSTRAINT IF EXISTS "verify_review_predictions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "verify_review_predictions" ADD CONSTRAINT "verify_review_predictions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_review_predictions_check_result_id_idx" ON "verify_review_predictions" USING btree ("check_result_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_review_predictions_user_id_idx" ON "verify_review_predictions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_review_predictions_workspace_id_idx" ON "verify_review_predictions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_review_predictions_model_idx" ON "verify_review_predictions" USING btree ("provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verify_review_predictions_result_model_prompt_unique" ON "verify_review_predictions" USING btree ("check_result_id","provider","model","prompt_version");