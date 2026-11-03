CREATE INDEX IF NOT EXISTS "messages_message_group_id_idx" ON "messages" USING btree ("message_group_id");
