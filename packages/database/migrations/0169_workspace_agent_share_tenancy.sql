ALTER TABLE "agent_shares" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "agent_shares" DROP CONSTRAINT IF EXISTS "agent_shares_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_shares_workspace_id_idx" ON "agent_shares" USING btree ("workspace_id");