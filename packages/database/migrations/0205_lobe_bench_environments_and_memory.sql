CREATE TABLE IF NOT EXISTS "agent_eval_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"run_id" text NOT NULL,
	"topic_id" text,
	"thread_id" text,
	"attempt_id" text NOT NULL,
	"layer" text NOT NULL,
	"source" text NOT NULL,
	"fixture_hash" text,
	"title" text,
	"summary" text,
	"details" text,
	"memory_category" text,
	"memory_type" text,
	"tags" jsonb,
	"payload" jsonb NOT NULL,
	"embedding" vector(1024),
	"captured_at" timestamp with time zone NOT NULL,
	"removed_reason" text,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_eval_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"identifier" text,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD COLUMN IF NOT EXISTS "environment_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_run_id_agent_eval_runs_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_run_id_agent_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memories" DROP CONSTRAINT IF EXISTS "agent_eval_memories_thread_id_threads_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memories" ADD CONSTRAINT "agent_eval_memories_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_environments" DROP CONSTRAINT IF EXISTS "agent_eval_environments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_environments" ADD CONSTRAINT "agent_eval_environments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_environments" DROP CONSTRAINT IF EXISTS "agent_eval_environments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_environments" ADD CONSTRAINT "agent_eval_environments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_attempt_id_idx" ON "agent_eval_memories" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_run_id_idx" ON "agent_eval_memories" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_topic_id_idx" ON "agent_eval_memories" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_thread_id_idx" ON "agent_eval_memories" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_user_id_idx" ON "agent_eval_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_memories_workspace_id_idx" ON "agent_eval_memories" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_environments_user_id_idx" ON "agent_eval_environments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_environments_workspace_id_idx" ON "agent_eval_environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_environments_identifier_user_id_unique" ON "agent_eval_environments" USING btree ("identifier","user_id") WHERE "agent_eval_environments"."identifier" IS NOT NULL AND "agent_eval_environments"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_environments_identifier_workspace_id_unique" ON "agent_eval_environments" USING btree ("identifier","workspace_id") WHERE "agent_eval_environments"."identifier" IS NOT NULL AND "agent_eval_environments"."workspace_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_environment_id_agent_eval_environments_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_environment_id_agent_eval_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."agent_eval_environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_test_cases_environment_id_idx" ON "agent_eval_test_cases" USING btree ("environment_id");
--> statement-breakpoint
-- The attempt Memory's lexical index. An eval attempt's Memory tool runs the account
-- Memory's search over `agent_eval_memories`: the same paradedb.match conjunction, with
-- the same tokenizer as 0093, over the headline columns and the layer fields that live
-- inside `payload`. Created only when pg_search is installed, like every BM25 index.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_search') THEN
    EXECUTE $bm25$
      CREATE INDEX IF NOT EXISTS agent_eval_memories_bm25_idx ON agent_eval_memories
      USING bm25 (id, title, summary, details, payload, layer, user_id, attempt_id)
      WITH (
        key_field = 'id',
        text_fields = '{
          "title":      {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
          "summary":    {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
          "details":    {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
          "layer":      {"fast": true, "tokenizer": {"type": "keyword"}},
          "user_id":    {"fast": true, "tokenizer": {"type": "keyword"}},
          "attempt_id": {"fast": true, "tokenizer": {"type": "keyword"}}
        }',
        json_fields = '{
          "payload": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}}
        }'
      )
    $bm25$;
  END IF;
END $$;
