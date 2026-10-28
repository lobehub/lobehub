CREATE INDEX IF NOT EXISTS "channel_jobs_channel_requester_idx" ON "channel_jobs" USING btree ("channel_id","requester_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_channel_thread_created_at_idx" ON "channel_jobs" USING btree ("channel_id","thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_member_grants_channel_requester_idx" ON "channel_member_grants" USING btree ("channel_id","requested_by_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_messages_user_id_idx" ON "channel_messages" USING btree ("user_id") WHERE "channel_messages"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_messages_agent_id_idx" ON "channel_messages" USING btree ("agent_id") WHERE "channel_messages"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_threads_root_message_idx" ON "channel_threads" USING btree ("channel_id","root_message_id");