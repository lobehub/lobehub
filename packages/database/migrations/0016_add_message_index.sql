CREATE INDEX IF NOT EXISTS "messages_topic_id_idx" ON "messages" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_parent_id_idx" ON "messages" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_quota_id_idx" ON "messages" USING btree ("quota_id");
