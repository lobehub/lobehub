ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "captured_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "captured_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD COLUMN IF NOT EXISTS "captured_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD COLUMN IF NOT EXISTS "captured_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "captured_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_user_id_idx" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_source_type_idx" ON "documents" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_user_id_idx" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_user_id_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_banned_true_created_at_idx" ON "users" USING btree ("created_at") WHERE "users"."banned" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_user_id_index" ON "user_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_contexts_user_id_index" ON "user_memories_contexts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_experiences_user_id_index" ON "user_memories_experiences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_experiences_user_memory_id_index" ON "user_memories_experiences" USING btree ("user_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_identities_user_id_index" ON "user_memories_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_identities_user_memory_id_index" ON "user_memories_identities" USING btree ("user_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_preferences_user_id_index" ON "user_memories_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_preferences_user_memory_id_index" ON "user_memories_preferences" USING btree ("user_memory_id");
