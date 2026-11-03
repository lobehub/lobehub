CREATE INDEX IF NOT EXISTS "agents_files_agent_id_idx" ON "agents_files" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_groups_topic_id_idx" ON "message_groups" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_agent_id_idx" ON "messages" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_to_sessions_session_id_idx" ON "agents_to_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_to_sessions_agent_id_idx" ON "agents_to_sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_id_updated_at_idx" ON "sessions" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_group_id_idx" ON "sessions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_topic_id_idx" ON "threads" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_session_id_idx" ON "topics" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_group_id_idx" ON "topics" USING btree ("group_id");
