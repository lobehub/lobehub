ALTER TABLE "agent_accounts" ADD COLUMN IF NOT EXISTS "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_topic_id_idx" ON "agent_inbox_messages" USING btree ("topic_id");
