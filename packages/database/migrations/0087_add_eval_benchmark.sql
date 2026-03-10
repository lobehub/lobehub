CREATE TABLE IF NOT EXISTS "agent_eval_benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rubrics" jsonb NOT NULL,
	"reference_url" text,
	"metadata" jsonb,
	"is_system" boolean DEFAULT true NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_eval_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"benchmark_id" text NOT NULL,
	"identifier" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"description" text,
	"eval_mode" text,
	"eval_config" jsonb,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_eval_run_topics" (
	"user_id" text NOT NULL,
	"run_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"test_case_id" text NOT NULL,
	"status" text,
	"score" real,
	"passed" boolean,
	"eval_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_eval_run_topics_run_id_topic_id_pk" PRIMARY KEY("run_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"target_agent_id" text,
	"user_id" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"config" jsonb,
	"metrics" jsonb,
	"started_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_eval_test_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"eval_mode" text,
	"eval_config" jsonb,
	"metadata" jsonb,
	"sort_order" integer,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" DROP CONSTRAINT IF EXISTS "agent_eval_datasets_benchmark_id_agent_eval_benchmarks_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_benchmark_id_agent_eval_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."agent_eval_benchmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" DROP CONSTRAINT IF EXISTS "agent_eval_datasets_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" DROP CONSTRAINT IF EXISTS "agent_eval_run_topics_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" ADD CONSTRAINT "agent_eval_run_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" DROP CONSTRAINT IF EXISTS "agent_eval_run_topics_run_id_agent_eval_runs_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" ADD CONSTRAINT "agent_eval_run_topics_run_id_agent_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" DROP CONSTRAINT IF EXISTS "agent_eval_run_topics_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" ADD CONSTRAINT "agent_eval_run_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" DROP CONSTRAINT IF EXISTS "agent_eval_run_topics_test_case_id_agent_eval_test_cases_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" ADD CONSTRAINT "agent_eval_run_topics_test_case_id_agent_eval_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."agent_eval_test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_runs" DROP CONSTRAINT IF EXISTS "agent_eval_runs_dataset_id_agent_eval_datasets_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD CONSTRAINT "agent_eval_runs_dataset_id_agent_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."agent_eval_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_runs" DROP CONSTRAINT IF EXISTS "agent_eval_runs_target_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD CONSTRAINT "agent_eval_runs_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_runs" DROP CONSTRAINT IF EXISTS "agent_eval_runs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD CONSTRAINT "agent_eval_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_dataset_id_agent_eval_datasets_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_dataset_id_agent_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."agent_eval_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_benchmarks_identifier_unique" ON "agent_eval_benchmarks" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_benchmarks_is_system_idx" ON "agent_eval_benchmarks" USING btree ("is_system");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_datasets_identifier_user_id_unique" ON "agent_eval_datasets" USING btree ("identifier","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_datasets_benchmark_id_idx" ON "agent_eval_datasets" USING btree ("benchmark_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_datasets_user_id_idx" ON "agent_eval_datasets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_run_topics_user_id_idx" ON "agent_eval_run_topics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_run_topics_run_id_idx" ON "agent_eval_run_topics" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_run_topics_test_case_id_idx" ON "agent_eval_run_topics" USING btree ("test_case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_dataset_id_idx" ON "agent_eval_runs" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_user_id_idx" ON "agent_eval_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_status_idx" ON "agent_eval_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_target_agent_id_idx" ON "agent_eval_runs" USING btree ("target_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_test_cases_user_id_idx" ON "agent_eval_test_cases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_test_cases_dataset_id_idx" ON "agent_eval_test_cases" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_test_cases_sort_order_idx" ON "agent_eval_test_cases" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_type_idx" ON "threads" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_trigger_idx" ON "topics" USING btree ("trigger");
