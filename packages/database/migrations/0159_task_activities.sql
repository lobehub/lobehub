CREATE TABLE IF NOT EXISTS "task_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"actor_user_id" text,
	"actor_agent_id" text,
	"type" text NOT NULL,
	"payload" jsonb,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_actor_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_activities" DROP CONSTRAINT IF EXISTS "task_activities_actor_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "task_activities" ADD CONSTRAINT "task_activities_actor_agent_id_agents_id_fk" FOREIGN KEY ("actor_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activities_task_id_idx" ON "task_activities" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activities_user_id_idx" ON "task_activities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activities_workspace_id_idx" ON "task_activities" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_activities_workspace_visibility_idx" ON "task_activities" USING btree ("workspace_id","visibility","user_id");
