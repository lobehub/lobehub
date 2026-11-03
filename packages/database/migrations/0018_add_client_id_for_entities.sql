ALTER TABLE "session_groups" DROP CONSTRAINT IF EXISTS "session_group_client_id_user_unique";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_client_id_user_id_unique";--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topic_client_id_user_id_unique";--> statement-breakpoint

-- add client_id column
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "message_plugins" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "message_queries" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "message_tts" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "message_translates" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "unstructured_chunks" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint

-- Create unique index（using IF NOT EXISTS）
CREATE UNIQUE INDEX IF NOT EXISTS "client_id_user_id_unique" ON "agents" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "files_client_id_user_id_unique" ON "files" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_bases_client_id_user_id_unique" ON "knowledge_bases" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_plugins_client_id_user_id_unique" ON "message_plugins" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_queries_client_id_user_id_unique" ON "message_queries" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_tts_client_id_user_id_unique" ON "message_tts" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_translates_client_id_user_id_unique" ON "message_translates" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chunks_client_id_user_id_unique" ON "chunks" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "embeddings_client_id_user_id_unique" ON "embeddings" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unstructured_chunks_client_id_user_id_unique" ON "unstructured_chunks" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_groups_client_id_user_id_unique" ON "session_groups" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_client_id_user_id_unique" ON "sessions" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "threads_client_id_user_id_unique" ON "threads" USING btree ("client_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topics_client_id_user_id_unique" ON "topics" USING btree ("client_id","user_id");
