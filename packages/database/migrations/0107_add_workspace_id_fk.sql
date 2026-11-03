ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents_files" DROP CONSTRAINT IF EXISTS "agents_files_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agents_files" ADD CONSTRAINT "agents_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents_knowledge_bases" DROP CONSTRAINT IF EXISTS "agents_knowledge_bases_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agents_knowledge_bases" ADD CONSTRAINT "agents_knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bot_providers" DROP CONSTRAINT IF EXISTS "agent_bot_providers_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_bot_providers" ADD CONSTRAINT "agent_bot_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" DROP CONSTRAINT IF EXISTS "agent_cron_jobs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_cron_jobs" ADD CONSTRAINT "agent_cron_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_documents" DROP CONSTRAINT IF EXISTS "agent_documents_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_benchmarks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" ADD CONSTRAINT "agent_eval_benchmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" DROP CONSTRAINT IF EXISTS "agent_eval_datasets_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_experiment_benchmarks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_experiment_benchmarks" ADD CONSTRAINT "agent_eval_experiment_benchmarks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_experiments" DROP CONSTRAINT IF EXISTS "agent_eval_experiments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_experiments" ADD CONSTRAINT "agent_eval_experiments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" DROP CONSTRAINT IF EXISTS "agent_eval_run_topics_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_run_topics" ADD CONSTRAINT "agent_eval_run_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_runs" DROP CONSTRAINT IF EXISTS "agent_eval_runs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_runs" ADD CONSTRAINT "agent_eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" DROP CONSTRAINT IF EXISTS "agent_eval_test_cases_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ADD CONSTRAINT "agent_eval_test_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_operations" DROP CONSTRAINT IF EXISTS "agent_operations_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" DROP CONSTRAINT IF EXISTS "agent_skills_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" DROP CONSTRAINT IF EXISTS "ai_providers_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_tasks" DROP CONSTRAINT IF EXISTS "async_tasks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups" DROP CONSTRAINT IF EXISTS "chat_groups_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups_agents" DROP CONSTRAINT IF EXISTS "chat_groups_agents_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connector_tools" DROP CONSTRAINT IF EXISTS "user_connector_tools_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "user_connector_tools" ADD CONSTRAINT "user_connector_tools_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connectors" DROP CONSTRAINT IF EXISTS "user_connectors_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "user_connectors" ADD CONSTRAINT "user_connectors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_histories" DROP CONSTRAINT IF EXISTS "document_histories_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_histories" ADD CONSTRAINT "document_histories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" DROP CONSTRAINT IF EXISTS "document_shares_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base_files" DROP CONSTRAINT IF EXISTS "knowledge_base_files_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "knowledge_base_files" ADD CONSTRAINT "knowledge_base_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" DROP CONSTRAINT IF EXISTS "knowledge_bases_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_batches" DROP CONSTRAINT IF EXISTS "generation_batches_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_topics" DROP CONSTRAINT IF EXISTS "generation_topics_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "generation_topics" ADD CONSTRAINT "generation_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" DROP CONSTRAINT IF EXISTS "generations_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_generation_tracing" DROP CONSTRAINT IF EXISTS "llm_generation_tracing_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "llm_generation_tracing" ADD CONSTRAINT "llm_generation_tracing_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_chunks" DROP CONSTRAINT IF EXISTS "message_chunks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "message_chunks" ADD CONSTRAINT "message_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_groups" DROP CONSTRAINT IF EXISTS "message_groups_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_plugins" DROP CONSTRAINT IF EXISTS "message_plugins_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "message_plugins" ADD CONSTRAINT "message_plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_queries" DROP CONSTRAINT IF EXISTS "message_queries_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "message_queries" ADD CONSTRAINT "message_queries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_query_chunks" DROP CONSTRAINT IF EXISTS "message_query_chunks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "message_query_chunks" ADD CONSTRAINT "message_query_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_tts" DROP CONSTRAINT IF EXISTS "message_tts_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "message_tts" ADD CONSTRAINT "message_tts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_translates" DROP CONSTRAINT IF EXISTS "message_translates_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "message_translates" ADD CONSTRAINT "message_translates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_files" DROP CONSTRAINT IF EXISTS "messages_files_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "messages_files" ADD CONSTRAINT "messages_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_account_links" DROP CONSTRAINT IF EXISTS "messenger_account_links_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD CONSTRAINT "messenger_account_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" DROP CONSTRAINT IF EXISTS "chunks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" DROP CONSTRAINT IF EXISTS "document_chunks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" DROP CONSTRAINT IF EXISTS "embeddings_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unstructured_chunks" DROP CONSTRAINT IF EXISTS "unstructured_chunks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "unstructured_chunks" ADD CONSTRAINT "unstructured_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT IF EXISTS "rag_eval_dataset_records_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" DROP CONSTRAINT IF EXISTS "rag_eval_datasets_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD CONSTRAINT "rag_eval_datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT IF EXISTS "rag_eval_evaluations_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_roles" DROP CONSTRAINT IF EXISTS "rbac_roles_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "rbac_roles" ADD CONSTRAINT "rbac_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_user_roles" DROP CONSTRAINT IF EXISTS "rbac_user_roles_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "rbac_user_roles" ADD CONSTRAINT "rbac_user_roles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents_to_sessions" DROP CONSTRAINT IF EXISTS "agents_to_sessions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agents_to_sessions" ADD CONSTRAINT "agents_to_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" DROP CONSTRAINT IF EXISTS "file_chunks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files_to_sessions" DROP CONSTRAINT IF EXISTS "files_to_sessions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "files_to_sessions" ADD CONSTRAINT "files_to_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_groups" DROP CONSTRAINT IF EXISTS "session_groups_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "session_groups" ADD CONSTRAINT "session_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" DROP CONSTRAINT IF EXISTS "briefs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" DROP CONSTRAINT IF EXISTS "task_dependencies_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" DROP CONSTRAINT IF EXISTS "task_documents_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_topics" DROP CONSTRAINT IF EXISTS "task_topics_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_topics" ADD CONSTRAINT "task_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_documents" DROP CONSTRAINT IF EXISTS "topic_documents_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "topic_documents" ADD CONSTRAINT "topic_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_shares" DROP CONSTRAINT IF EXISTS "topic_shares_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "topic_shares" ADD CONSTRAINT "topic_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_installed_plugins" DROP CONSTRAINT IF EXISTS "user_installed_plugins_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD CONSTRAINT "user_installed_plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
