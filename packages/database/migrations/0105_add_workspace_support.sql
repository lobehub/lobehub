CREATE TABLE IF NOT EXISTS "workspace_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(1000),
	"avatar" text,
	"primary_owner_id" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rbac_roles" DROP CONSTRAINT IF EXISTS "rbac_roles_name_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "agents_slug_user_id_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "agent_eval_benchmarks_identifier_user_id_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "agent_eval_datasets_identifier_user_id_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "agent_skills_user_name_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "documents_slug_user_id_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "slug_user_id_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "tasks_identifier_idx";
--> statement-breakpoint
ALTER TABLE "rbac_user_roles" DROP CONSTRAINT IF EXISTS "rbac_user_roles_user_id_role_id_pk";
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agents_files" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agents_knowledge_bases" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_bot_providers" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_documents" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_eval_experiments" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_operations" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "async_tasks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "chat_groups_agents" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "document_histories" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_base_files" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "generation_batches" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "generation_topics" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "llm_generation_tracing" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "message_chunks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "message_groups" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "message_plugins" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "message_queries" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "message_query_chunks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "message_tts" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "message_translates" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "messages_files" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "embeddings" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "unstructured_chunks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "rbac_roles" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "rbac_user_roles" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "agents_to_sessions" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "file_chunks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "files_to_sessions" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "task_documents" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "topic_documents" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "topic_shares" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD COLUMN IF NOT EXISTS "workspace_id" text;
--> statement-breakpoint
ALTER TABLE "workspace_audit_logs" DROP CONSTRAINT IF EXISTS "workspace_audit_logs_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_audit_logs" ADD CONSTRAINT "workspace_audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_invitations" DROP CONSTRAINT IF EXISTS "workspace_invitations_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_invitations" DROP CONSTRAINT IF EXISTS "workspace_invitations_inviter_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_members" DROP CONSTRAINT IF EXISTS "workspace_members_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_members" DROP CONSTRAINT IF EXISTS "workspace_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_primary_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_primary_owner_id_users_id_fk" FOREIGN KEY ("primary_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_audit_logs_workspace_id_idx" ON "workspace_audit_logs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_audit_logs_action_idx" ON "workspace_audit_logs" USING btree ("action");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_audit_logs_created_at_idx" ON "workspace_audit_logs" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_id_idx" ON "workspace_invitations" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_email_idx" ON "workspace_invitations" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_token_idx" ON "workspace_invitations" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_user_id_idx" ON "workspace_members" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_slug_idx" ON "workspaces" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_primary_owner_id_idx" ON "workspaces" USING btree ("primary_owner_id");
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agents_files" DROP CONSTRAINT IF EXISTS "agents_files_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agents_files" ADD CONSTRAINT "agents_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agents_knowledge_bases" DROP CONSTRAINT IF EXISTS "agents_knowledge_bases_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agents_knowledge_bases" ADD CONSTRAINT "agents_knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_bot_providers" DROP CONSTRAINT IF EXISTS "agent_bot_providers_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_bot_providers" ADD CONSTRAINT "agent_bot_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" DROP CONSTRAINT IF EXISTS "agent_cron_jobs_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" ADD CONSTRAINT "agent_cron_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_documents" DROP CONSTRAINT IF EXISTS "agent_documents_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_benchmarks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" ADD CONSTRAINT "agent_eval_benchmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" DROP CONSTRAINT IF EXISTS "agent_eval_datasets_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_experiment_benchmarks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" ADD CONSTRAINT "agent_eval_experiment_benchmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_eval_experiments" DROP CONSTRAINT IF EXISTS "agent_eval_experiments_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_eval_experiments" ADD CONSTRAINT "agent_eval_experiments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" DROP CONSTRAINT IF EXISTS "agent_eval_run_topics_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" ADD CONSTRAINT "agent_eval_run_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_eval_runs" DROP CONSTRAINT IF EXISTS "agent_eval_runs_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD CONSTRAINT "agent_eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT IF EXISTS "agent_operations_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_skills" DROP CONSTRAINT IF EXISTS "agent_skills_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_providers" DROP CONSTRAINT IF EXISTS "ai_providers_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "async_tasks" DROP CONSTRAINT IF EXISTS "async_tasks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_groups" DROP CONSTRAINT IF EXISTS "chat_groups_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_groups_agents" DROP CONSTRAINT IF EXISTS "chat_groups_agents_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_histories" DROP CONSTRAINT IF EXISTS "document_histories_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "document_histories" ADD CONSTRAINT "document_histories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_base_files" DROP CONSTRAINT IF EXISTS "knowledge_base_files_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_base_files" ADD CONSTRAINT "knowledge_base_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_bases" DROP CONSTRAINT IF EXISTS "knowledge_bases_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generation_batches" DROP CONSTRAINT IF EXISTS "generation_batches_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generation_topics" DROP CONSTRAINT IF EXISTS "generation_topics_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "generation_topics" ADD CONSTRAINT "generation_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generations" DROP CONSTRAINT IF EXISTS "generations_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "llm_generation_tracing" DROP CONSTRAINT IF EXISTS "llm_generation_tracing_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "llm_generation_tracing" ADD CONSTRAINT "llm_generation_tracing_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_chunks" DROP CONSTRAINT IF EXISTS "message_chunks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "message_chunks" ADD CONSTRAINT "message_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_groups" DROP CONSTRAINT IF EXISTS "message_groups_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_plugins" DROP CONSTRAINT IF EXISTS "message_plugins_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "message_plugins" ADD CONSTRAINT "message_plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_queries" DROP CONSTRAINT IF EXISTS "message_queries_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "message_queries" ADD CONSTRAINT "message_queries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_query_chunks" DROP CONSTRAINT IF EXISTS "message_query_chunks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "message_query_chunks" ADD CONSTRAINT "message_query_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_tts" DROP CONSTRAINT IF EXISTS "message_tts_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "message_tts" ADD CONSTRAINT "message_tts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_translates" DROP CONSTRAINT IF EXISTS "message_translates_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "message_translates" ADD CONSTRAINT "message_translates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages_files" DROP CONSTRAINT IF EXISTS "messages_files_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "messages_files" ADD CONSTRAINT "messages_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messenger_account_links" DROP CONSTRAINT IF EXISTS "messenger_account_links_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD CONSTRAINT "messenger_account_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chunks" DROP CONSTRAINT IF EXISTS "chunks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "document_chunks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "embeddings" DROP CONSTRAINT IF EXISTS "embeddings_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "unstructured_chunks" DROP CONSTRAINT IF EXISTS "unstructured_chunks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "unstructured_chunks" ADD CONSTRAINT "unstructured_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT IF EXISTS "rag_eval_dataset_records_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" DROP CONSTRAINT IF EXISTS "rag_eval_datasets_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD CONSTRAINT "rag_eval_datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT IF EXISTS "rag_eval_evaluations_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rbac_roles" DROP CONSTRAINT IF EXISTS "rbac_roles_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "rbac_roles" ADD CONSTRAINT "rbac_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "rbac_user_roles" DROP CONSTRAINT IF EXISTS "rbac_user_roles_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "rbac_user_roles" ADD CONSTRAINT "rbac_user_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agents_to_sessions" DROP CONSTRAINT IF EXISTS "agents_to_sessions_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "agents_to_sessions" ADD CONSTRAINT "agents_to_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "file_chunks" DROP CONSTRAINT IF EXISTS "file_chunks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files_to_sessions" DROP CONSTRAINT IF EXISTS "files_to_sessions_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "files_to_sessions" ADD CONSTRAINT "files_to_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_groups" DROP CONSTRAINT IF EXISTS "session_groups_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "session_groups" ADD CONSTRAINT "session_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_dependencies" DROP CONSTRAINT IF EXISTS "task_dependencies_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_documents" DROP CONSTRAINT IF EXISTS "task_documents_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_topics" DROP CONSTRAINT IF EXISTS "task_topics_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "task_topics" ADD CONSTRAINT "task_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "topic_documents" DROP CONSTRAINT IF EXISTS "topic_documents_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "topic_documents" ADD CONSTRAINT "topic_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "topic_shares" DROP CONSTRAINT IF EXISTS "topic_shares_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "topic_shares" ADD CONSTRAINT "topic_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_installed_plugins" DROP CONSTRAINT IF EXISTS "user_installed_plugins_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD CONSTRAINT "user_installed_plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_slug_workspace_id_unique" ON "agents" USING btree ("workspace_id","slug") WHERE "agents"."workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_workspace_id_idx" ON "agents" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_files_workspace_id_idx" ON "agents_files" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_knowledge_bases_workspace_id_idx" ON "agents_knowledge_bases" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bot_providers_workspace_id_idx" ON "agent_bot_providers" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_cron_jobs_workspace_id_idx" ON "agent_cron_jobs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_workspace_id_idx" ON "agent_documents" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_benchmarks_identifier_workspace_id_unique" ON "agent_eval_benchmarks" USING btree ("workspace_id","identifier") WHERE "agent_eval_benchmarks"."workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_benchmarks_workspace_id_idx" ON "agent_eval_benchmarks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_datasets_identifier_workspace_id_unique" ON "agent_eval_datasets" USING btree ("workspace_id","identifier") WHERE "agent_eval_datasets"."workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_datasets_workspace_id_idx" ON "agent_eval_datasets" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_experiment_benchmarks_workspace_id_idx" ON "agent_eval_experiment_benchmarks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_experiments_workspace_id_idx" ON "agent_eval_experiments" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_run_topics_workspace_id_idx" ON "agent_eval_run_topics" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_runs_workspace_id_idx" ON "agent_eval_runs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_test_cases_workspace_id_idx" ON "agent_eval_test_cases" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_workspace_id_idx" ON "agent_operations" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_workspace_id_name_unique" ON "agent_skills" USING btree ("workspace_id","name") WHERE "agent_skills"."workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_workspace_id_idx" ON "agent_skills" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_models_workspace_id_idx" ON "ai_models" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_providers_workspace_id_idx" ON "ai_providers" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_workspace_id_idx" ON "api_keys" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "async_tasks_workspace_id_idx" ON "async_tasks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_groups_workspace_id_idx" ON "chat_groups" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_groups_agents_workspace_id_idx" ON "chat_groups_agents" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_histories_workspace_id_idx" ON "document_histories" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_slug_workspace_id_unique" ON "documents" USING btree ("workspace_id","slug") WHERE "documents"."workspace_id" IS NOT NULL AND "documents"."slug" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_workspace_id_idx" ON "documents" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_workspace_id_idx" ON "files" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_base_files_workspace_id_idx" ON "knowledge_base_files" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_bases_workspace_id_idx" ON "knowledge_bases" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_batches_workspace_id_idx" ON "generation_batches" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_topics_workspace_id_idx" ON "generation_topics" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generations_workspace_id_idx" ON "generations" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generation_tracing_workspace_id_idx" ON "llm_generation_tracing" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_chunks_workspace_id_idx" ON "message_chunks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_groups_workspace_id_idx" ON "message_groups" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_plugins_workspace_id_idx" ON "message_plugins" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_queries_workspace_id_idx" ON "message_queries" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_query_chunks_workspace_id_idx" ON "message_query_chunks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_tts_workspace_id_idx" ON "message_tts" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_translates_workspace_id_idx" ON "message_translates" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_workspace_id_idx" ON "messages" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_files_workspace_id_idx" ON "messages_files" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messenger_account_links_workspace_id_idx" ON "messenger_account_links" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_workspace_id_idx" ON "chunks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_workspace_id_idx" ON "document_chunks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_workspace_id_idx" ON "embeddings" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unstructured_chunks_workspace_id_idx" ON "unstructured_chunks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_eval_dataset_records_workspace_id_idx" ON "rag_eval_dataset_records" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_eval_datasets_workspace_id_idx" ON "rag_eval_datasets" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_eval_evaluations_workspace_id_idx" ON "rag_eval_evaluations" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_eval_evaluation_records_workspace_id_idx" ON "rag_eval_evaluation_records" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rbac_roles_name_scope_unique" ON "rbac_roles" USING btree ("name",COALESCE("workspace_id", ''));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rbac_roles_workspace_id_idx" ON "rbac_roles" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rbac_user_roles_user_role_scope_unique" ON "rbac_user_roles" USING btree ("user_id","role_id",COALESCE("workspace_id", ''));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rbac_user_roles_workspace_id_idx" ON "rbac_user_roles" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_to_sessions_workspace_id_idx" ON "agents_to_sessions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_chunks_workspace_id_idx" ON "file_chunks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_to_sessions_workspace_id_idx" ON "files_to_sessions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_groups_workspace_id_idx" ON "session_groups" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_slug_workspace_id_unique" ON "sessions" USING btree ("workspace_id","slug") WHERE "sessions"."workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_workspace_id_idx" ON "sessions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_workspace_id_idx" ON "briefs" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_workspace_id_idx" ON "task_comments" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_dependencies_workspace_id_idx" ON "task_dependencies" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_documents_workspace_id_idx" ON "task_documents" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_topics_workspace_id_idx" ON "task_topics" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_identifier_workspace_id_unique" ON "tasks" USING btree ("identifier","workspace_id") WHERE "tasks"."workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_workspace_id_idx" ON "tasks" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_workspace_id_idx" ON "threads" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_documents_workspace_id_idx" ON "topic_documents" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_shares_workspace_id_idx" ON "topic_shares" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_workspace_id_idx" ON "topics" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_installed_plugins_workspace_id_idx" ON "user_installed_plugins" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_slug_user_id_unique" ON "agents" USING btree ("slug","user_id") WHERE "agents"."workspace_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_benchmarks_identifier_user_id_unique" ON "agent_eval_benchmarks" USING btree ("identifier","user_id") WHERE "agent_eval_benchmarks"."workspace_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_datasets_identifier_user_id_unique" ON "agent_eval_datasets" USING btree ("identifier","user_id") WHERE "agent_eval_datasets"."workspace_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_user_name_idx" ON "agent_skills" USING btree ("user_id","name") WHERE "agent_skills"."workspace_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_slug_user_id_unique" ON "documents" USING btree ("slug","user_id") WHERE "documents"."workspace_id" IS NULL AND "documents"."slug" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slug_user_id_unique" ON "sessions" USING btree ("slug","user_id") WHERE "sessions"."workspace_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_identifier_idx" ON "tasks" USING btree ("identifier","created_by_user_id") WHERE "tasks"."workspace_id" IS NULL;

--> statement-breakpoint
-- Workspace RBAC role tuning (data migration; no-op if roles not yet seeded).
DELETE FROM "rbac_role_permissions"
WHERE "role_id" IN (
  SELECT "id" FROM "rbac_roles" WHERE "name" = 'workspace_viewer'
)
AND "permission_id" IN (
  SELECT "id" FROM "rbac_permissions" WHERE "code" = 'ai_model:invoke:all'
);
--> statement-breakpoint
UPDATE "rbac_roles"
SET "description" = 'Read-only access to workspace content.'
WHERE "name" = 'workspace_viewer';
--> statement-breakpoint
ALTER TABLE "document_shares" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "document_shares" DROP CONSTRAINT IF EXISTS "document_shares_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_shares_workspace_id_idx" ON "document_shares" USING btree ("workspace_id");
