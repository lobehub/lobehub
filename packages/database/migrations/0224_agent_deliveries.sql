CREATE TABLE IF NOT EXISTS "agent_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"parent_delivery_id" uuid,
	"requester_user_id" text,
	"project_id" text,
	"channel_id" text,
	"task_id" text,
	"title" text,
	"summary" text,
	"category" text,
	"outcome" text DEFAULT 'unknown' NOT NULL,
	"outcome_source" text,
	"outcome_confidence" real,
	"shots" integer,
	"frictions" jsonb,
	"total_cost" numeric(20, 6),
	"total_tokens" integer,
	"tool_calls" integer,
	"user_messages" integer,
	"agent_messages" integer,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"distilled_at" timestamp with time zone,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_delivery_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"work_id" text NOT NULL,
	"workspace_id" text,
	"role" text NOT NULL,
	"work_version_id" uuid,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_deliveries" DROP CONSTRAINT IF EXISTS "agent_deliveries_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_deliveries" ADD CONSTRAINT "agent_deliveries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliveries" DROP CONSTRAINT IF EXISTS "agent_deliveries_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_deliveries" ADD CONSTRAINT "agent_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliveries" DROP CONSTRAINT IF EXISTS "agent_deliveries_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_deliveries" ADD CONSTRAINT "agent_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliveries" DROP CONSTRAINT IF EXISTS "agent_deliveries_parent_delivery_id_agent_deliveries_id_fk";--> statement-breakpoint
ALTER TABLE "agent_deliveries" ADD CONSTRAINT "agent_deliveries_parent_delivery_id_agent_deliveries_id_fk" FOREIGN KEY ("parent_delivery_id") REFERENCES "public"."agent_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliveries" DROP CONSTRAINT IF EXISTS "agent_deliveries_requester_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_deliveries" ADD CONSTRAINT "agent_deliveries_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliveries" DROP CONSTRAINT IF EXISTS "agent_deliveries_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "agent_deliveries" ADD CONSTRAINT "agent_deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliveries" DROP CONSTRAINT IF EXISTS "agent_deliveries_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "agent_deliveries" ADD CONSTRAINT "agent_deliveries_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deliveries" DROP CONSTRAINT IF EXISTS "agent_deliveries_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "agent_deliveries" ADD CONSTRAINT "agent_deliveries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delivery_works" DROP CONSTRAINT IF EXISTS "agent_delivery_works_delivery_id_agent_deliveries_id_fk";--> statement-breakpoint
ALTER TABLE "agent_delivery_works" ADD CONSTRAINT "agent_delivery_works_delivery_id_agent_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."agent_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delivery_works" DROP CONSTRAINT IF EXISTS "agent_delivery_works_work_id_works_id_fk";--> statement-breakpoint
ALTER TABLE "agent_delivery_works" ADD CONSTRAINT "agent_delivery_works_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delivery_works" DROP CONSTRAINT IF EXISTS "agent_delivery_works_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_delivery_works" ADD CONSTRAINT "agent_delivery_works_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_delivery_works" DROP CONSTRAINT IF EXISTS "agent_delivery_works_work_version_id_work_versions_id_fk";--> statement-breakpoint
ALTER TABLE "agent_delivery_works" ADD CONSTRAINT "agent_delivery_works_work_version_id_work_versions_id_fk" FOREIGN KEY ("work_version_id") REFERENCES "public"."work_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_deliveries_subject_agent_unique" ON "agent_deliveries" USING btree ("subject_type","subject_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_deliveries_agent_id_settled_at_idx" ON "agent_deliveries" USING btree ("agent_id","settled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_deliveries_user_id_settled_at_idx" ON "agent_deliveries" USING btree ("user_id","settled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_deliveries_workspace_id_settled_at_idx" ON "agent_deliveries" USING btree ("workspace_id","settled_at") WHERE "agent_deliveries"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_deliveries_parent_delivery_id_idx" ON "agent_deliveries" USING btree ("parent_delivery_id") WHERE "agent_deliveries"."parent_delivery_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_deliveries_project_id_idx" ON "agent_deliveries" USING btree ("project_id") WHERE "agent_deliveries"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_deliveries_task_id_idx" ON "agent_deliveries" USING btree ("task_id") WHERE "agent_deliveries"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_delivery_works_delivery_id_work_id_unique" ON "agent_delivery_works" USING btree ("delivery_id","work_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_delivery_works_work_id_idx" ON "agent_delivery_works" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_delivery_works_workspace_id_idx" ON "agent_delivery_works" USING btree ("workspace_id") WHERE "agent_delivery_works"."workspace_id" IS NOT NULL;