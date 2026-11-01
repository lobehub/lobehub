ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "coordinator_agent_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_coordinator_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_coordinator_agent_id_agents_id_fk" FOREIGN KEY ("coordinator_agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_coordinator_agent_id_unique" ON "projects" USING btree ("coordinator_agent_id");
