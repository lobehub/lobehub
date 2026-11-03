-- 解决 chunks 表慢查询
CREATE INDEX IF NOT EXISTS "chunks_user_id_idx" ON "chunks" USING btree ("user_id");--> statement-breakpoint

-- 解决 topics 表批量删除慢查询
CREATE INDEX IF NOT EXISTS "topics_user_id_idx" ON "topics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_id_user_id_idx" ON "topics" USING btree ("id","user_id");--> statement-breakpoint

-- 解决 sessions 表删除慢查询
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_id_user_id_idx" ON "sessions" USING btree ("id","user_id");--> statement-breakpoint

-- 解决 messages 表统计查询慢查询
CREATE INDEX IF NOT EXISTS "messages_user_id_idx" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_session_id_idx" ON "messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_thread_id_idx" ON "messages" USING btree ("thread_id");--> statement-breakpoint

-- 解决 embeddings 删除慢查询
CREATE INDEX IF NOT EXISTS "embeddings_chunk_id_idx" ON "embeddings" USING btree ("chunk_id");--> statement-breakpoint
