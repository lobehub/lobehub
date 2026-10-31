CREATE TABLE IF NOT EXISTS "agent_eval_environments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
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
ALTER TABLE "agent_eval_test_cases" ADD COLUMN IF NOT EXISTS "environment_id" text;--> statement-breakpoint
ALTER TABLE "agent_eval_environments" DROP CONSTRAINT IF EXISTS "agent_eval_environments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_environments" ADD CONSTRAINT "agent_eval_environments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_environments" DROP CONSTRAINT IF EXISTS "agent_eval_environments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_environments" ADD CONSTRAINT "agent_eval_environments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_environments_user_id_idx" ON "agent_eval_environments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_environments_workspace_id_idx" ON "agent_eval_environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_environments_identifier_user_id_unique" ON "agent_eval_environments" USING btree ("identifier","user_id") WHERE "agent_eval_environments"."identifier" IS NOT NULL AND "agent_eval_environments"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_environments_identifier_workspace_id_unique" ON "agent_eval_environments" USING btree ("identifier","workspace_id") WHERE "agent_eval_environments"."identifier" IS NOT NULL AND "agent_eval_environments"."workspace_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_environment_id_agent_eval_environments_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_environment_id_agent_eval_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."agent_eval_environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_test_cases_environment_id_idx" ON "agent_eval_test_cases" USING btree ("environment_id");