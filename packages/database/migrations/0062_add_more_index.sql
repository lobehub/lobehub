CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "async_tasks_user_id_idx" ON "async_tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_groups_group_id_idx" ON "chat_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "global_files_creator_idx" ON "global_files" USING btree ("creator");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_base_files_kb_id_idx" ON "knowledge_base_files" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_bases_user_id_idx" ON "knowledge_bases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_batches_user_id_idx" ON "generation_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_batches_topic_id_idx" ON "generation_batches" USING btree ("generation_topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_topics_user_id_idx" ON "generation_topics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generations_user_id_idx" ON "generations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generations_batch_id_idx" ON "generations" USING btree ("generation_batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_group_id_idx" ON "messages" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_document_id_idx" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_chunk_id_idx" ON "document_chunks" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_user_id_idx" ON "embeddings" USING btree ("user_id");
