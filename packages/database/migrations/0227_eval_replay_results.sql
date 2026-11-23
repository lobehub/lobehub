CREATE TABLE IF NOT EXISTS "agent_eval_replay_results" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"run_id" text NOT NULL,
	"test_case_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"usage" jsonb,
	"duration_ms" integer,
	"score" real,
	"passed" boolean,
	"judge_reason" text,
	"error" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD COLUMN IF NOT EXISTS "source_topic_id" text;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD COLUMN IF NOT EXISTS "source_message_id" text;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD COLUMN IF NOT EXISTS "source_operation_id" text;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD COLUMN IF NOT EXISTS "frozen_step_index" integer;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD COLUMN IF NOT EXISTS "frozen_call" jsonb;--> statement-breakpoint
ALTER TABLE "agent_eval_replay_results" DROP CONSTRAINT IF EXISTS "agent_eval_replay_results_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_replay_results" ADD CONSTRAINT "agent_eval_replay_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_replay_results" DROP CONSTRAINT IF EXISTS "agent_eval_replay_results_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_replay_results" ADD CONSTRAINT "agent_eval_replay_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_replay_results" DROP CONSTRAINT IF EXISTS "agent_eval_replay_results_run_id_agent_eval_runs_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_replay_results" ADD CONSTRAINT "agent_eval_replay_results_run_id_agent_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_replay_results" DROP CONSTRAINT IF EXISTS "agent_eval_replay_results_test_case_id_agent_eval_test_cases_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_replay_results" ADD CONSTRAINT "agent_eval_replay_results_test_case_id_agent_eval_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."agent_eval_test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_replay_results_cell_unique" ON "agent_eval_replay_results" USING btree ("run_id","test_case_id","provider","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_replay_results_run_id_idx" ON "agent_eval_replay_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_replay_results_test_case_id_idx" ON "agent_eval_replay_results" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_replay_results_user_id_idx" ON "agent_eval_replay_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_replay_results_workspace_id_idx" ON "agent_eval_replay_results" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_source_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_source_topic_id_topics_id_fk" FOREIGN KEY ("source_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_source_message_id_messages_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_test_cases_source_message_id_idx" ON "agent_eval_test_cases" USING btree ("source_message_id");