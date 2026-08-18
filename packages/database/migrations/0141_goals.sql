CREATE TABLE IF NOT EXISTS "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"agent_id" text,
	"project_id" text,
	"title" text NOT NULL,
	"requirement" text,
	"max_rounds" integer,
	"max_total_cost" numeric(20, 6),
	"status" text DEFAULT 'planning' NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_user_id_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_workspace_id_idx" ON "goals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_agent_id_idx" ON "goals" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_project_id_idx" ON "goals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_status_idx" ON "goals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goals_subject_idx" ON "goals" USING btree ("subject_type","subject_id");
