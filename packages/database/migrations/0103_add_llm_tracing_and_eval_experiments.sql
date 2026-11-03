CREATE TABLE IF NOT EXISTS "agent_eval_experiment_benchmarks" (
	"experiment_id" text NOT NULL,
	"benchmark_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_eval_experiment_benchmarks_experiment_id_benchmark_id_pk" PRIMARY KEY("experiment_id","benchmark_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_eval_experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_generation_tracing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario" text NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"schema_name" text,
	"user_id" text NOT NULL,
	"agent_id" text,
	"topic_id" text,
	"trigger" text,
	"parent_tracing_id" uuid,
	"provider" text,
	"model" text,
	"success" boolean NOT NULL,
	"error_code" text,
	"error_detail" text,
	"validation_failed" boolean DEFAULT false NOT NULL,
	"input_hash" text,
	"input_hint" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 8),
	"storage_key" text,
	"feedback_signal" text,
	"feedback_score" numeric(3, 2),
	"feedback_source" text,
	"feedback_data" jsonb,
	"feedback_updated_at" timestamp with time zone,
	"trace_id" text,
	"span_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ADD COLUMN IF NOT EXISTS "source_experiment_id" text;--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD COLUMN IF NOT EXISTS "experiment_id" text;--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD COLUMN IF NOT EXISTS "parent_run_id" text;--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_experiment_benchmarks_experiment_id_agent_eval_experiments_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" ADD CONSTRAINT "agent_eval_experiment_benchmarks_experiment_id_agent_eval_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."agent_eval_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_experiment_benchmarks_benchmark_id_agent_eval_benchmarks_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" ADD CONSTRAINT "agent_eval_experiment_benchmarks_benchmark_id_agent_eval_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."agent_eval_benchmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_experiment_benchmarks_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" ADD CONSTRAINT "agent_eval_experiment_benchmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_experiments" DROP CONSTRAINT IF EXISTS "agent_eval_experiments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_experiments" ADD CONSTRAINT "agent_eval_experiments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_experiment_benchmarks_benchmark_id_idx" ON "agent_eval_experiment_benchmarks" USING btree ("benchmark_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_experiment_benchmarks_user_id_idx" ON "agent_eval_experiment_benchmarks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_experiments_user_id_idx" ON "agent_eval_experiments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_scenario_idx" ON "llm_generation_tracing" USING btree ("scenario");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_prompt_version_idx" ON "llm_generation_tracing" USING btree ("prompt_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_user_id_idx" ON "llm_generation_tracing" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_agent_id_idx" ON "llm_generation_tracing" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_topic_id_idx" ON "llm_generation_tracing" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_provider_idx" ON "llm_generation_tracing" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_model_idx" ON "llm_generation_tracing" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_success_idx" ON "llm_generation_tracing" USING btree ("success");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_error_code_idx" ON "llm_generation_tracing" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_validation_failed_idx" ON "llm_generation_tracing" USING btree ("validation_failed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_feedback_signal_idx" ON "llm_generation_tracing" USING btree ("feedback_signal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_created_at_idx" ON "llm_generation_tracing" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" DROP CONSTRAINT IF EXISTS "agent_eval_datasets_source_experiment_id_agent_eval_experiments_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_source_experiment_id_agent_eval_experiments_id_fk" FOREIGN KEY ("source_experiment_id") REFERENCES "public"."agent_eval_experiments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_runs" DROP CONSTRAINT IF EXISTS "agent_eval_runs_experiment_id_agent_eval_experiments_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD CONSTRAINT "agent_eval_runs_experiment_id_agent_eval_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."agent_eval_experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_runs" DROP CONSTRAINT IF EXISTS "agent_eval_runs_parent_run_id_agent_eval_runs_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD CONSTRAINT "agent_eval_runs_parent_run_id_agent_eval_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."agent_eval_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_datasets_source_experiment_id_idx" ON "agent_eval_datasets" USING btree ("source_experiment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_experiment_id_idx" ON "agent_eval_runs" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_parent_run_id_idx" ON "agent_eval_runs" USING btree ("parent_run_id");
