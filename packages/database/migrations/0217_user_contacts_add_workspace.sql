DROP INDEX IF EXISTS "user_contacts_agent_unique";--> statement-breakpoint
ALTER TABLE "user_contacts" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "user_contacts" DROP CONSTRAINT IF EXISTS "user_contacts_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_workspace_agent_unique" ON "user_contacts" USING btree ("workspace_id","agent_id") WHERE "user_contacts"."agent_id" IS NOT NULL AND "user_contacts"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_agent_unique" ON "user_contacts" USING btree ("user_id","agent_id") WHERE "user_contacts"."agent_id" IS NOT NULL AND "user_contacts"."workspace_id" IS NULL;
