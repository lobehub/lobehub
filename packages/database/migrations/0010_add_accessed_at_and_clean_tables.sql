DROP TABLE "agents_tags" CASCADE;--> statement-breakpoint
DROP TABLE "market" CASCADE;--> statement-breakpoint
DROP TABLE "plugins" CASCADE;--> statement-breakpoint
DROP TABLE "plugins_tags" CASCADE;--> statement-breakpoint
DROP TABLE "tags" CASCADE;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agents_files" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agents_knowledge_bases" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "async_tasks" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "global_files" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "unstructured_chunks" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "accessed_at" timestamp with time zone DEFAULT now() NOT NULL;