CREATE TABLE IF NOT EXISTS "agent_eval_memory_scopes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"run_id" text NOT NULL,
	"test_case_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"thread_id" text,
	"memory_user_id" text NOT NULL,
	"fixture_hash" text NOT NULL,
	"final_snapshot" jsonb,
	"cleaned_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_memory_owner_is_synthetic" CHECK ("agent_eval_memory_scopes"."memory_user_id" LIKE 'eval-memory:%' AND "agent_eval_memory_scopes"."memory_user_id" <> "agent_eval_memory_scopes"."user_id")
);
--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" DROP CONSTRAINT IF EXISTS "agent_eval_memory_scopes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" ADD CONSTRAINT "agent_eval_memory_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" DROP CONSTRAINT IF EXISTS "agent_eval_memory_scopes_run_id_agent_eval_runs_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" ADD CONSTRAINT "agent_eval_memory_scopes_run_id_agent_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" DROP CONSTRAINT IF EXISTS "agent_eval_memory_scopes_test_case_id_agent_eval_test_cases_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" ADD CONSTRAINT "agent_eval_memory_scopes_test_case_id_agent_eval_test_cases_id_fk" FOREIGN KEY ("test_case_id") REFERENCES "public"."agent_eval_test_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" DROP CONSTRAINT IF EXISTS "agent_eval_memory_scopes_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" ADD CONSTRAINT "agent_eval_memory_scopes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" DROP CONSTRAINT IF EXISTS "agent_eval_memory_scopes_thread_id_threads_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_memory_scopes" ADD CONSTRAINT "agent_eval_memory_scopes_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eval_memory_scopes_topic_unique" ON "agent_eval_memory_scopes" USING btree ("run_id","topic_id") WHERE "agent_eval_memory_scopes"."thread_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eval_memory_scopes_thread_unique" ON "agent_eval_memory_scopes" USING btree ("run_id","topic_id","thread_id") WHERE "agent_eval_memory_scopes"."thread_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eval_memory_scopes_memory_user_unique" ON "agent_eval_memory_scopes" USING btree ("memory_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eval_memory_scopes_user_id_index" ON "agent_eval_memory_scopes" USING btree ("user_id");
--> statement-breakpoint
-- Delete the storage-only owner when a run, case, topic, or scope is deleted.
-- Normal terminal cleanup retains the mapping and its final snapshot instead.
CREATE OR REPLACE FUNCTION cleanup_eval_memory_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM users WHERE id = OLD.memory_user_id
    AND id LIKE 'eval-memory:%' AND banned = true AND ban_reason = 'eval-memory-storage-only';
  RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS eval_memory_scope_delete_owner ON agent_eval_memory_scopes;
--> statement-breakpoint
CREATE TRIGGER eval_memory_scope_delete_owner AFTER DELETE ON agent_eval_memory_scopes
FOR EACH ROW EXECUTE FUNCTION cleanup_eval_memory_owner();
