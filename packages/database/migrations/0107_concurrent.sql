-- =============================================================================
-- 0107_concurrent.sql — PRODUCTION-SAFE manual runbook (NOT run by drizzle)
-- =============================================================================
-- Adds workspace_id FK on 70 tables WITHOUT long write-blocking locks.
--
-- Why this file is separate from 0107_add_workspace_id_fk.sql:
--   drizzle runs every migration inside ONE transaction, where the value of
--   NOT VALID + VALIDATE is lost (locks held until COMMIT, no low-peak phasing).
--   So run THIS file by hand, outside drizzle, statement by statement.
--
-- Operating procedure (cloud production):
--   1. Run STEP 1 in one go — each ADD ... NOT VALID takes only a brief
--      AccessExclusive lock (< 1ms/table), no table scan.
--   2. Run STEP 2 statement-by-statement, ideally in a low-peak window. Big
--      tables (messages / message_chunks / generations / files) can be run
--      serially. VALIDATE takes ShareUpdateExclusiveLock — it does NOT block DML.
--      Since workspace_id is 100% NULL today, each VALIDATE is effectively a
--      no-op scan.
--   3. After all constraints are VALID, mark 0107 as already-applied in drizzle
--      so the migrator does not DROP+re-ADD them:
--        INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
--        VALUES ('<hash of 0107_add_workspace_id_fk.sql>', <journal.when>);
--      (hash = sha256 of the migration file content, per drizzle migrator.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1: add constraints as NOT VALID (fast, brief lock, no scan)
-- -----------------------------------------------------------------------------
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_workspace_id_workspaces_id_fk";
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agents_files" DROP CONSTRAINT IF EXISTS "agents_files_workspace_id_workspaces_id_fk";
ALTER TABLE "agents_files" ADD CONSTRAINT "agents_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agents_knowledge_bases" DROP CONSTRAINT IF EXISTS "agents_knowledge_bases_workspace_id_workspaces_id_fk";
ALTER TABLE "agents_knowledge_bases" ADD CONSTRAINT "agents_knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_bot_providers" DROP CONSTRAINT IF EXISTS "agent_bot_providers_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_bot_providers" ADD CONSTRAINT "agent_bot_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_cron_jobs" DROP CONSTRAINT IF EXISTS "agent_cron_jobs_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_cron_jobs" ADD CONSTRAINT "agent_cron_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_documents" DROP CONSTRAINT IF EXISTS "agent_documents_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_eval_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_benchmarks_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_benchmarks" ADD CONSTRAINT "agent_eval_benchmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_eval_datasets" DROP CONSTRAINT IF EXISTS "agent_eval_datasets_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_eval_experiment_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_experiment_benchmarks_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_experiment_benchmarks" ADD CONSTRAINT "agent_eval_experiment_benchmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_eval_experiments" DROP CONSTRAINT IF EXISTS "agent_eval_experiments_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_experiments" ADD CONSTRAINT "agent_eval_experiments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_eval_run_topics" DROP CONSTRAINT IF EXISTS "agent_eval_run_topics_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_run_topics" ADD CONSTRAINT "agent_eval_run_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_eval_runs" DROP CONSTRAINT IF EXISTS "agent_eval_runs_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_runs" ADD CONSTRAINT "agent_eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_operations" DROP CONSTRAINT IF EXISTS "agent_operations_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agent_skills" DROP CONSTRAINT IF EXISTS "agent_skills_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_workspace_id_workspaces_id_fk";
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "ai_providers" DROP CONSTRAINT IF EXISTS "ai_providers_workspace_id_workspaces_id_fk";
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_workspace_id_workspaces_id_fk";
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "async_tasks" DROP CONSTRAINT IF EXISTS "async_tasks_workspace_id_workspaces_id_fk";
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "chat_groups" DROP CONSTRAINT IF EXISTS "chat_groups_workspace_id_workspaces_id_fk";
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "chat_groups_agents" DROP CONSTRAINT IF EXISTS "chat_groups_agents_workspace_id_workspaces_id_fk";
ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "user_connector_tools" DROP CONSTRAINT IF EXISTS "user_connector_tools_workspace_id_workspaces_id_fk";
ALTER TABLE "user_connector_tools" ADD CONSTRAINT "user_connector_tools_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "user_connectors" DROP CONSTRAINT IF EXISTS "user_connectors_workspace_id_workspaces_id_fk";
ALTER TABLE "user_connectors" ADD CONSTRAINT "user_connectors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_workspace_id_workspaces_id_fk";
ALTER TABLE "devices" ADD CONSTRAINT "devices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "document_histories" DROP CONSTRAINT IF EXISTS "document_histories_workspace_id_workspaces_id_fk";
ALTER TABLE "document_histories" ADD CONSTRAINT "document_histories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "document_shares" DROP CONSTRAINT IF EXISTS "document_shares_workspace_id_workspaces_id_fk";
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_workspace_id_workspaces_id_fk";
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_workspace_id_workspaces_id_fk";
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "knowledge_base_files" DROP CONSTRAINT IF EXISTS "knowledge_base_files_workspace_id_workspaces_id_fk";
ALTER TABLE "knowledge_base_files" ADD CONSTRAINT "knowledge_base_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "knowledge_bases" DROP CONSTRAINT IF EXISTS "knowledge_bases_workspace_id_workspaces_id_fk";
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "generation_batches" DROP CONSTRAINT IF EXISTS "generation_batches_workspace_id_workspaces_id_fk";
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "generation_topics" DROP CONSTRAINT IF EXISTS "generation_topics_workspace_id_workspaces_id_fk";
ALTER TABLE "generation_topics" ADD CONSTRAINT "generation_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "generations" DROP CONSTRAINT IF EXISTS "generations_workspace_id_workspaces_id_fk";
ALTER TABLE "generations" ADD CONSTRAINT "generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "llm_generation_tracing" DROP CONSTRAINT IF EXISTS "llm_generation_tracing_workspace_id_workspaces_id_fk";
ALTER TABLE "llm_generation_tracing" ADD CONSTRAINT "llm_generation_tracing_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "message_chunks" DROP CONSTRAINT IF EXISTS "message_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "message_chunks" ADD CONSTRAINT "message_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "message_groups" DROP CONSTRAINT IF EXISTS "message_groups_workspace_id_workspaces_id_fk";
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "message_plugins" DROP CONSTRAINT IF EXISTS "message_plugins_workspace_id_workspaces_id_fk";
ALTER TABLE "message_plugins" ADD CONSTRAINT "message_plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "message_queries" DROP CONSTRAINT IF EXISTS "message_queries_workspace_id_workspaces_id_fk";
ALTER TABLE "message_queries" ADD CONSTRAINT "message_queries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "message_query_chunks" DROP CONSTRAINT IF EXISTS "message_query_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "message_query_chunks" ADD CONSTRAINT "message_query_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "message_tts" DROP CONSTRAINT IF EXISTS "message_tts_workspace_id_workspaces_id_fk";
ALTER TABLE "message_tts" ADD CONSTRAINT "message_tts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "message_translates" DROP CONSTRAINT IF EXISTS "message_translates_workspace_id_workspaces_id_fk";
ALTER TABLE "message_translates" ADD CONSTRAINT "message_translates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_workspace_id_workspaces_id_fk";
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "messages_files" DROP CONSTRAINT IF EXISTS "messages_files_workspace_id_workspaces_id_fk";
ALTER TABLE "messages_files" ADD CONSTRAINT "messages_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "messenger_account_links" DROP CONSTRAINT IF EXISTS "messenger_account_links_workspace_id_workspaces_id_fk";
ALTER TABLE "messenger_account_links" ADD CONSTRAINT "messenger_account_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "chunks" DROP CONSTRAINT IF EXISTS "chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "document_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "embeddings" DROP CONSTRAINT IF EXISTS "embeddings_workspace_id_workspaces_id_fk";
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "unstructured_chunks" DROP CONSTRAINT IF EXISTS "unstructured_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "unstructured_chunks" ADD CONSTRAINT "unstructured_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT IF EXISTS "rag_eval_dataset_records_workspace_id_workspaces_id_fk";
ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "rag_eval_datasets" DROP CONSTRAINT IF EXISTS "rag_eval_datasets_workspace_id_workspaces_id_fk";
ALTER TABLE "rag_eval_datasets" ADD CONSTRAINT "rag_eval_datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT IF EXISTS "rag_eval_evaluations_workspace_id_workspaces_id_fk";
ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_workspace_id_workspaces_id_fk";
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "rbac_roles" DROP CONSTRAINT IF EXISTS "rbac_roles_workspace_id_workspaces_id_fk";
ALTER TABLE "rbac_roles" ADD CONSTRAINT "rbac_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "rbac_user_roles" DROP CONSTRAINT IF EXISTS "rbac_user_roles_workspace_id_workspaces_id_fk";
ALTER TABLE "rbac_user_roles" ADD CONSTRAINT "rbac_user_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "agents_to_sessions" DROP CONSTRAINT IF EXISTS "agents_to_sessions_workspace_id_workspaces_id_fk";
ALTER TABLE "agents_to_sessions" ADD CONSTRAINT "agents_to_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "file_chunks" DROP CONSTRAINT IF EXISTS "file_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "files_to_sessions" DROP CONSTRAINT IF EXISTS "files_to_sessions_workspace_id_workspaces_id_fk";
ALTER TABLE "files_to_sessions" ADD CONSTRAINT "files_to_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "session_groups" DROP CONSTRAINT IF EXISTS "session_groups_workspace_id_workspaces_id_fk";
ALTER TABLE "session_groups" ADD CONSTRAINT "session_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_workspace_id_workspaces_id_fk";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_workspace_id_workspaces_id_fk";
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_workspace_id_workspaces_id_fk";
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "task_dependencies" DROP CONSTRAINT IF EXISTS "task_dependencies_workspace_id_workspaces_id_fk";
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "task_documents" DROP CONSTRAINT IF EXISTS "task_documents_workspace_id_workspaces_id_fk";
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "task_topics" DROP CONSTRAINT IF EXISTS "task_topics_workspace_id_workspaces_id_fk";
ALTER TABLE "task_topics" ADD CONSTRAINT "task_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_workspace_id_workspaces_id_fk";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_workspace_id_workspaces_id_fk";
ALTER TABLE "threads" ADD CONSTRAINT "threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "topic_documents" DROP CONSTRAINT IF EXISTS "topic_documents_workspace_id_workspaces_id_fk";
ALTER TABLE "topic_documents" ADD CONSTRAINT "topic_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "topic_shares" DROP CONSTRAINT IF EXISTS "topic_shares_workspace_id_workspaces_id_fk";
ALTER TABLE "topic_shares" ADD CONSTRAINT "topic_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_workspace_id_workspaces_id_fk";
ALTER TABLE "topics" ADD CONSTRAINT "topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
ALTER TABLE "user_installed_plugins" DROP CONSTRAINT IF EXISTS "user_installed_plugins_workspace_id_workspaces_id_fk";
ALTER TABLE "user_installed_plugins" ADD CONSTRAINT "user_installed_plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action NOT VALID;

-- -----------------------------------------------------------------------------
-- STEP 2: validate constraints (no DML block; run in low-peak, big tables serial)
-- -----------------------------------------------------------------------------
ALTER TABLE "agents" VALIDATE CONSTRAINT "agents_workspace_id_workspaces_id_fk";
ALTER TABLE "agents_files" VALIDATE CONSTRAINT "agents_files_workspace_id_workspaces_id_fk";
ALTER TABLE "agents_knowledge_bases" VALIDATE CONSTRAINT "agents_knowledge_bases_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_bot_providers" VALIDATE CONSTRAINT "agent_bot_providers_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_cron_jobs" VALIDATE CONSTRAINT "agent_cron_jobs_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_documents" VALIDATE CONSTRAINT "agent_documents_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_benchmarks" VALIDATE CONSTRAINT "agent_eval_benchmarks_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_datasets" VALIDATE CONSTRAINT "agent_eval_datasets_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_experiment_benchmarks" VALIDATE CONSTRAINT "agent_eval_experiment_benchmarks_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_experiments" VALIDATE CONSTRAINT "agent_eval_experiments_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_run_topics" VALIDATE CONSTRAINT "agent_eval_run_topics_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_runs" VALIDATE CONSTRAINT "agent_eval_runs_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_eval_test_cases" VALIDATE CONSTRAINT "agent_eval_test_cases_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_operations" VALIDATE CONSTRAINT "agent_operations_workspace_id_workspaces_id_fk";
ALTER TABLE "agent_skills" VALIDATE CONSTRAINT "agent_skills_workspace_id_workspaces_id_fk";
ALTER TABLE "ai_models" VALIDATE CONSTRAINT "ai_models_workspace_id_workspaces_id_fk";
ALTER TABLE "ai_providers" VALIDATE CONSTRAINT "ai_providers_workspace_id_workspaces_id_fk";
ALTER TABLE "api_keys" VALIDATE CONSTRAINT "api_keys_workspace_id_workspaces_id_fk";
ALTER TABLE "async_tasks" VALIDATE CONSTRAINT "async_tasks_workspace_id_workspaces_id_fk";
ALTER TABLE "chat_groups" VALIDATE CONSTRAINT "chat_groups_workspace_id_workspaces_id_fk";
ALTER TABLE "chat_groups_agents" VALIDATE CONSTRAINT "chat_groups_agents_workspace_id_workspaces_id_fk";
ALTER TABLE "user_connector_tools" VALIDATE CONSTRAINT "user_connector_tools_workspace_id_workspaces_id_fk";
ALTER TABLE "user_connectors" VALIDATE CONSTRAINT "user_connectors_workspace_id_workspaces_id_fk";
ALTER TABLE "devices" VALIDATE CONSTRAINT "devices_workspace_id_workspaces_id_fk";
ALTER TABLE "document_histories" VALIDATE CONSTRAINT "document_histories_workspace_id_workspaces_id_fk";
ALTER TABLE "document_shares" VALIDATE CONSTRAINT "document_shares_workspace_id_workspaces_id_fk";
ALTER TABLE "documents" VALIDATE CONSTRAINT "documents_workspace_id_workspaces_id_fk";
ALTER TABLE "files" VALIDATE CONSTRAINT "files_workspace_id_workspaces_id_fk";
ALTER TABLE "knowledge_base_files" VALIDATE CONSTRAINT "knowledge_base_files_workspace_id_workspaces_id_fk";
ALTER TABLE "knowledge_bases" VALIDATE CONSTRAINT "knowledge_bases_workspace_id_workspaces_id_fk";
ALTER TABLE "generation_batches" VALIDATE CONSTRAINT "generation_batches_workspace_id_workspaces_id_fk";
ALTER TABLE "generation_topics" VALIDATE CONSTRAINT "generation_topics_workspace_id_workspaces_id_fk";
ALTER TABLE "generations" VALIDATE CONSTRAINT "generations_workspace_id_workspaces_id_fk";
ALTER TABLE "llm_generation_tracing" VALIDATE CONSTRAINT "llm_generation_tracing_workspace_id_workspaces_id_fk";
ALTER TABLE "message_chunks" VALIDATE CONSTRAINT "message_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "message_groups" VALIDATE CONSTRAINT "message_groups_workspace_id_workspaces_id_fk";
ALTER TABLE "message_plugins" VALIDATE CONSTRAINT "message_plugins_workspace_id_workspaces_id_fk";
ALTER TABLE "message_queries" VALIDATE CONSTRAINT "message_queries_workspace_id_workspaces_id_fk";
ALTER TABLE "message_query_chunks" VALIDATE CONSTRAINT "message_query_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "message_tts" VALIDATE CONSTRAINT "message_tts_workspace_id_workspaces_id_fk";
ALTER TABLE "message_translates" VALIDATE CONSTRAINT "message_translates_workspace_id_workspaces_id_fk";
ALTER TABLE "messages" VALIDATE CONSTRAINT "messages_workspace_id_workspaces_id_fk";
ALTER TABLE "messages_files" VALIDATE CONSTRAINT "messages_files_workspace_id_workspaces_id_fk";
ALTER TABLE "messenger_account_links" VALIDATE CONSTRAINT "messenger_account_links_workspace_id_workspaces_id_fk";
ALTER TABLE "chunks" VALIDATE CONSTRAINT "chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "document_chunks" VALIDATE CONSTRAINT "document_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "embeddings" VALIDATE CONSTRAINT "embeddings_workspace_id_workspaces_id_fk";
ALTER TABLE "unstructured_chunks" VALIDATE CONSTRAINT "unstructured_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "rag_eval_dataset_records" VALIDATE CONSTRAINT "rag_eval_dataset_records_workspace_id_workspaces_id_fk";
ALTER TABLE "rag_eval_datasets" VALIDATE CONSTRAINT "rag_eval_datasets_workspace_id_workspaces_id_fk";
ALTER TABLE "rag_eval_evaluations" VALIDATE CONSTRAINT "rag_eval_evaluations_workspace_id_workspaces_id_fk";
ALTER TABLE "rag_eval_evaluation_records" VALIDATE CONSTRAINT "rag_eval_evaluation_records_workspace_id_workspaces_id_fk";
ALTER TABLE "rbac_roles" VALIDATE CONSTRAINT "rbac_roles_workspace_id_workspaces_id_fk";
ALTER TABLE "rbac_user_roles" VALIDATE CONSTRAINT "rbac_user_roles_workspace_id_workspaces_id_fk";
ALTER TABLE "agents_to_sessions" VALIDATE CONSTRAINT "agents_to_sessions_workspace_id_workspaces_id_fk";
ALTER TABLE "file_chunks" VALIDATE CONSTRAINT "file_chunks_workspace_id_workspaces_id_fk";
ALTER TABLE "files_to_sessions" VALIDATE CONSTRAINT "files_to_sessions_workspace_id_workspaces_id_fk";
ALTER TABLE "session_groups" VALIDATE CONSTRAINT "session_groups_workspace_id_workspaces_id_fk";
ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_workspace_id_workspaces_id_fk";
ALTER TABLE "briefs" VALIDATE CONSTRAINT "briefs_workspace_id_workspaces_id_fk";
ALTER TABLE "task_comments" VALIDATE CONSTRAINT "task_comments_workspace_id_workspaces_id_fk";
ALTER TABLE "task_dependencies" VALIDATE CONSTRAINT "task_dependencies_workspace_id_workspaces_id_fk";
ALTER TABLE "task_documents" VALIDATE CONSTRAINT "task_documents_workspace_id_workspaces_id_fk";
ALTER TABLE "task_topics" VALIDATE CONSTRAINT "task_topics_workspace_id_workspaces_id_fk";
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_workspace_id_workspaces_id_fk";
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_workspace_id_workspaces_id_fk";
ALTER TABLE "topic_documents" VALIDATE CONSTRAINT "topic_documents_workspace_id_workspaces_id_fk";
ALTER TABLE "topic_shares" VALIDATE CONSTRAINT "topic_shares_workspace_id_workspaces_id_fk";
ALTER TABLE "topics" VALIDATE CONSTRAINT "topics_workspace_id_workspaces_id_fk";
ALTER TABLE "user_installed_plugins" VALIDATE CONSTRAINT "user_installed_plugins_workspace_id_workspaces_id_fk";
