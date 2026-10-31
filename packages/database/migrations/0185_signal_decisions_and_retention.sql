-- Signal persistence + decisions.
--
-- Index rollout: `signals` was created in 0183 and nothing writes to it yet, so the two new
-- indexes on it are built inline. If a database already holds a large `signals` table, build the
-- same two indexes online by hand first (plain index DDL cannot run in a transaction there); the
-- IF NOT EXISTS statements below are then no-ops.
-- `signal_decisions` / `signal_decision_labels` are new and empty, so their indexes are inline.
CREATE TABLE IF NOT EXISTS "signal_decision_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"confidence" real,
	"actor" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signal_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"agent_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"scope_key" text NOT NULL,
	"pipeline_version" text NOT NULL,
	"outcome" text NOT NULL,
	"final_reason" text,
	"to_tag" text,
	"verdicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"llm_tracing_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"operation_id" text,
	"topic_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN IF NOT EXISTS "scope_key" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN IF NOT EXISTS "payload_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_decision_labels" DROP CONSTRAINT IF EXISTS "signal_decision_labels_decision_id_signal_decisions_id_fk";--> statement-breakpoint
ALTER TABLE "signal_decision_labels" ADD CONSTRAINT "signal_decision_labels_decision_id_signal_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."signal_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_decisions" DROP CONSTRAINT IF EXISTS "signal_decisions_signal_id_signals_id_fk";--> statement-breakpoint
ALTER TABLE "signal_decisions" ADD CONSTRAINT "signal_decisions_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_decisions" DROP CONSTRAINT IF EXISTS "signal_decisions_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "signal_decisions" ADD CONSTRAINT "signal_decisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_decisions" DROP CONSTRAINT IF EXISTS "signal_decisions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "signal_decisions" ADD CONSTRAINT "signal_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_decisions" DROP CONSTRAINT IF EXISTS "signal_decisions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "signal_decisions" ADD CONSTRAINT "signal_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_decisions" DROP CONSTRAINT IF EXISTS "signal_decisions_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "signal_decisions" ADD CONSTRAINT "signal_decisions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_decision_labels_decision_created_at_idx" ON "signal_decision_labels" USING btree ("decision_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signal_decisions_signal_agent_pipeline_unique" ON "signal_decisions" USING btree ("signal_id","agent_id","pipeline_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_decisions_signal_id_idx" ON "signal_decisions" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_decisions_user_scope_created_at_idx" ON "signal_decisions" USING btree ("user_id","scope_key","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_decisions_agent_created_at_idx" ON "signal_decisions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_user_scope_source_created_at_idx" ON "signals" USING btree ("user_id","scope_key","source","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_payload_unpurged_created_at_idx" ON "signals" USING btree ("created_at") WHERE "payload_purged_at" IS NULL;
