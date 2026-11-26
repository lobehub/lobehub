DROP INDEX IF EXISTS "channel_jobs_active_member_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "channel_jobs_active_directory_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_active_directory_idx" ON "channel_jobs" USING btree ("device_id","working_directory") WHERE "channel_jobs"."writer_held";--> statement-breakpoint
ALTER TABLE "channel_messages" DROP CONSTRAINT IF EXISTS "channel_messages_agent_sender_check";--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "agent_pair_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_agent_pair_unique" ON "channels" USING btree ("agent_pair_key","user_id",coalesce("workspace_id", '')) WHERE "channels"."agent_pair_key" IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "user_contacts_agent_unique";--> statement-breakpoint
ALTER TABLE "user_contacts" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "user_contacts" DROP CONSTRAINT IF EXISTS "user_contacts_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_workspace_agent_unique" ON "user_contacts" USING btree ("workspace_id","agent_id") WHERE "user_contacts"."agent_id" IS NOT NULL AND "user_contacts"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_agent_unique" ON "user_contacts" USING btree ("user_id","agent_id") WHERE "user_contacts"."agent_id" IS NOT NULL AND "user_contacts"."workspace_id" IS NULL;
