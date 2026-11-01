ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_topics" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_documents" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_workspace_visibility_idx" ON "agents" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_groups_workspace_visibility_idx" ON "chat_groups" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_workspace_visibility_idx" ON "documents" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_workspace_visibility_idx" ON "files" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_bases_workspace_visibility_idx" ON "knowledge_bases" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_topics_workspace_visibility_idx" ON "generation_topics" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_groups_workspace_visibility_idx" ON "session_groups" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_workspace_visibility_idx" ON "task_comments" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_deps_workspace_visibility_idx" ON "task_dependencies" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_docs_workspace_visibility_idx" ON "task_documents" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_topics_workspace_visibility_idx" ON "task_topics" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_workspace_visibility_idx" ON "tasks" USING btree ("workspace_id","visibility","created_by_user_id");