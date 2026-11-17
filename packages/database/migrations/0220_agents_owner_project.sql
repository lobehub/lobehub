CREATE TABLE IF NOT EXISTS "project_coordinator_ownership_log" (
	"project_id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"decision" text NOT NULL,
	"config_snapshot" jsonb,
	"marked" boolean DEFAULT false NOT NULL,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "owner_project_id" text;--> statement-breakpoint
ALTER TABLE "project_coordinator_ownership_log" DROP CONSTRAINT IF EXISTS "project_coordinator_ownership_log_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_coordinator_ownership_log" ADD CONSTRAINT "project_coordinator_ownership_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_owner_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_project_id_projects_id_fk" FOREIGN KEY ("owner_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_owner_project_id_idx" ON "agents" USING btree ("owner_project_id") WHERE "agents"."owner_project_id" is not null;