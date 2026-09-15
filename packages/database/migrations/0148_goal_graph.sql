CREATE TABLE IF NOT EXISTS "goal_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" text NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_edges_distinct_nodes" CHECK ("goal_edges"."source_node_id" <> "goal_edges"."target_node_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"task_id" text,
	"operation_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_node_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"authority" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"question" text NOT NULL,
	"options" jsonb,
	"recommended_option_id" text,
	"requested_user_id" text,
	"requested_project_role" text,
	"resolved_option_id" text,
	"resolution" text,
	"resolved_by_user_id" text,
	"resolved_by_agent_id" text,
	"resolved_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_node_work_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"work_version_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"task_id" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"confidence" numeric(4, 3),
	"created_by_user_id" text,
	"created_by_agent_id" text,
	"resolved_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_nodes_goal_id_id_unique" UNIQUE("goal_id","id"),
	CONSTRAINT "goal_nodes_task_requires_work_kind" CHECK ("goal_nodes"."task_id" IS NULL OR "goal_nodes"."kind" = 'work'),
	CONSTRAINT "goal_nodes_confidence_range" CHECK ("goal_nodes"."confidence" IS NULL OR ("goal_nodes"."confidence" >= 0 AND "goal_nodes"."confidence" <= 1))
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'goal_nodes_goal_id_id_unique'
			AND conrelid = 'public.goal_nodes'::regclass
	) THEN
		IF to_regclass('public.goal_nodes_goal_id_id_unique') IS NOT NULL THEN
			ALTER TABLE "goal_nodes"
				ADD CONSTRAINT "goal_nodes_goal_id_id_unique"
				UNIQUE USING INDEX "goal_nodes_goal_id_id_unique";
		ELSE
			ALTER TABLE "goal_nodes"
				ADD CONSTRAINT "goal_nodes_goal_id_id_unique" UNIQUE ("goal_id", "id");
		END IF;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "goal_edges" DROP CONSTRAINT IF EXISTS "goal_edges_goal_id_goals_id_fk";--> statement-breakpoint
ALTER TABLE "goal_edges" ADD CONSTRAINT "goal_edges_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_edges" DROP CONSTRAINT IF EXISTS "goal_edges_goal_source_node_fk";--> statement-breakpoint
ALTER TABLE "goal_edges" ADD CONSTRAINT "goal_edges_goal_source_node_fk" FOREIGN KEY ("goal_id","source_node_id") REFERENCES "public"."goal_nodes"("goal_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_edges" DROP CONSTRAINT IF EXISTS "goal_edges_goal_target_node_fk";--> statement-breakpoint
ALTER TABLE "goal_edges" ADD CONSTRAINT "goal_edges_goal_target_node_fk" FOREIGN KEY ("goal_id","target_node_id") REFERENCES "public"."goal_nodes"("goal_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_events" DROP CONSTRAINT IF EXISTS "goal_events_goal_id_goals_id_fk";--> statement-breakpoint
ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_events" DROP CONSTRAINT IF EXISTS "goal_events_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "goal_events" ADD CONSTRAINT "goal_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_node_decisions" DROP CONSTRAINT IF EXISTS "goal_node_decisions_node_id_goal_nodes_id_fk";--> statement-breakpoint
ALTER TABLE "goal_node_decisions" ADD CONSTRAINT "goal_node_decisions_node_id_goal_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."goal_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_node_decisions" DROP CONSTRAINT IF EXISTS "goal_node_decisions_requested_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "goal_node_decisions" ADD CONSTRAINT "goal_node_decisions_requested_user_id_users_id_fk" FOREIGN KEY ("requested_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_node_decisions" DROP CONSTRAINT IF EXISTS "goal_node_decisions_resolved_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "goal_node_decisions" ADD CONSTRAINT "goal_node_decisions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_node_decisions" DROP CONSTRAINT IF EXISTS "goal_node_decisions_resolved_by_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "goal_node_decisions" ADD CONSTRAINT "goal_node_decisions_resolved_by_agent_id_agents_id_fk" FOREIGN KEY ("resolved_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_node_work_versions" DROP CONSTRAINT IF EXISTS "goal_node_work_versions_node_id_goal_nodes_id_fk";--> statement-breakpoint
ALTER TABLE "goal_node_work_versions" ADD CONSTRAINT "goal_node_work_versions_node_id_goal_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."goal_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_node_work_versions" DROP CONSTRAINT IF EXISTS "goal_node_work_versions_work_version_id_work_versions_id_fk";--> statement-breakpoint
ALTER TABLE "goal_node_work_versions" ADD CONSTRAINT "goal_node_work_versions_work_version_id_work_versions_id_fk" FOREIGN KEY ("work_version_id") REFERENCES "public"."work_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_goal_id_goals_id_fk";--> statement-breakpoint
ALTER TABLE "goal_nodes" ADD CONSTRAINT "goal_nodes_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "goal_nodes" ADD CONSTRAINT "goal_nodes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_created_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "goal_nodes" ADD CONSTRAINT "goal_nodes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_created_by_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "goal_nodes" ADD CONSTRAINT "goal_nodes_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_edges_source_target_kind_unique" ON "goal_edges" USING btree ("source_node_id","target_node_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_edges_goal_id_idx" ON "goal_edges" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_edges_target_node_id_idx" ON "goal_edges" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_events_goal_id_created_at_idx" ON "goal_events" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_events_entity_idx" ON "goal_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_events_task_id_idx" ON "goal_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_events_operation_id_idx" ON "goal_events" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_node_decisions_node_id_unique" ON "goal_node_decisions" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_node_decisions_status_idx" ON "goal_node_decisions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_node_decisions_requested_user_id_status_idx" ON "goal_node_decisions" USING btree ("requested_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_node_work_versions_node_version_relation_unique" ON "goal_node_work_versions" USING btree ("node_id","work_version_id","relation");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_node_work_versions_work_version_id_idx" ON "goal_node_work_versions" USING btree ("work_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_nodes_goal_id_status_idx" ON "goal_nodes" USING btree ("goal_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_nodes_goal_id_kind_idx" ON "goal_nodes" USING btree ("goal_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_nodes_task_id_unique" ON "goal_nodes" USING btree ("task_id") WHERE "goal_nodes"."task_id" is not null;
