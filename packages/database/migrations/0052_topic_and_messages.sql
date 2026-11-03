ALTER TABLE "messages" DROP CONSTRAINT "messages_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "editor_data" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "content" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "editor_data" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_agent_id_idx" ON "topics" USING btree ("agent_id");
