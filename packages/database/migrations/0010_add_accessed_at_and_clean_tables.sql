DROP TABLE IF EXISTS "agents_tags" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "market" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "plugins" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "plugins_tags" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tags" CASCADE;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agents_files" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agents_knowledge_bases" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "async_tasks" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "global_files" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "unstructured_chunks" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;
