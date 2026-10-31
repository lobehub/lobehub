ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_coordinator_agent_id_agents_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "projects_coordinator_agent_id_unique";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "coordinator_agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_coordinator_agent_id_agents_id_fk" FOREIGN KEY ("coordinator_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_coordinator_agent_id_idx" ON "projects" USING btree ("coordinator_agent_id");
