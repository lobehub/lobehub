DROP INDEX IF EXISTS "user_memories_contexts_title_vector_index";--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "plugins" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "pinned" boolean;--> statement-breakpoint
ALTER TABLE "message_groups" ADD COLUMN IF NOT EXISTS "type" text;--> statement-breakpoint
ALTER TABLE "message_groups" ADD COLUMN IF NOT EXISTS "content" text;--> statement-breakpoint
ALTER TABLE "message_groups" ADD COLUMN IF NOT EXISTS "editor_data" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "summary" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "group_id" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "memory" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "interests" varchar(64)[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding" jsonb;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'threads_agent_id_agents_id_fk') THEN
    ALTER TABLE "threads" ADD CONSTRAINT "threads_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'threads_group_id_chat_groups_id_fk') THEN
    ALTER TABLE "threads" ADD CONSTRAINT "threads_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_models_user_id_idx" ON "ai_models" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_providers_user_id_idx" ON "ai_providers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_groups_type_idx" ON "message_groups" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_plugins_tool_call_id_idx" ON "message_plugins" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_agent_id_idx" ON "threads" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_group_id_idx" ON "threads" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "user_memories_contexts" DROP COLUMN IF EXISTS "title_vector";
