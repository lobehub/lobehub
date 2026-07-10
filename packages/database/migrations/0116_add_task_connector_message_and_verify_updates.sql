ALTER TABLE "user_connectors" ADD COLUMN IF NOT EXISTS "agent_id" text;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "trigger" text;--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "user_connectors" DROP CONSTRAINT IF EXISTS "user_connectors_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_connectors" ADD CONSTRAINT "user_connectors_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connectors_agent_id_idx" ON "user_connectors" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connectors_personal_identifier_idx" ON "user_connectors" USING btree ("user_id","identifier") WHERE "user_connectors"."workspace_id" is null AND "user_connectors"."agent_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connectors_workspace_identifier_idx" ON "user_connectors" USING btree ("user_id","workspace_id","identifier") WHERE "user_connectors"."workspace_id" is not null AND "user_connectors"."agent_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connectors_agent_identifier_idx" ON "user_connectors" USING btree ("agent_id","identifier") WHERE "user_connectors"."agent_id" is not null;--> statement-breakpoint
DROP INDEX IF EXISTS "user_connectors_agent_identifier_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "user_connectors_user_identifier_agent_null_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "user_connectors_user_identifier_unique";--> statement-breakpoint
-- Hot messages recent-query index.
--
-- On cloud production this index must be built online before deploy:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_topic_id_updated_at_idx"
--   ON "messages" USING btree ("topic_id","updated_at");
--
-- The guarded statement below is then a NO-OP on databases that already have
-- the index, while fresh / self-hosted databases still converge to the target
-- schema during normal migration replay. Keep this statement non-CONCURRENTLY
-- so local PGlite / normal migration replay remains compatible.
CREATE INDEX IF NOT EXISTS "messages_topic_id_updated_at_idx" ON "messages" USING btree ("topic_id","updated_at");
