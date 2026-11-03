CREATE TABLE IF NOT EXISTS "agents_files" (
	"file_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_files_file_id_agent_id_user_id_pk" PRIMARY KEY("file_id","agent_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents_knowledge_bases" (
	"agent_id" text NOT NULL,
	"knowledge_base_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_knowledge_bases_agent_id_knowledge_base_id_pk" PRIMARY KEY("agent_id","knowledge_base_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "async_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text,
	"status" text,
	"error" jsonb,
	"user_id" text NOT NULL,
	"duration" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_chunks" (
	"file_id" varchar,
	"chunk_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_chunks_file_id_chunk_id_pk" PRIMARY KEY("file_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "global_files" (
	"hash_id" varchar(64) PRIMARY KEY NOT NULL,
	"file_type" varchar(255) NOT NULL,
	"size" integer NOT NULL,
	"url" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_base_files" (
	"knowledge_base_id" text NOT NULL,
	"file_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_base_files_knowledge_base_id_file_id_pk" PRIMARY KEY("knowledge_base_id","file_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_bases" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"avatar" text,
	"type" text,
	"user_id" text NOT NULL,
	"is_public" boolean DEFAULT false,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_chunks" (
	"message_id" text,
	"chunk_id" uuid,
	CONSTRAINT "message_chunks_chunk_id_message_id_pk" PRIMARY KEY("chunk_id","message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"rewrite_query" text,
	"user_query" text,
	"embeddings_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_query_chunks" (
	"id" text,
	"query_id" uuid,
	"chunk_id" uuid,
	"similarity" numeric(6, 5),
	CONSTRAINT "message_query_chunks_chunk_id_id_query_id_pk" PRIMARY KEY("chunk_id","id","query_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text,
	"abstract" text,
	"metadata" jsonb,
	"index" integer,
	"type" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id" uuid,
	"embeddings" vector(1024),
	"model" text,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unstructured_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text,
	"metadata" jsonb,
	"index" integer,
	"type" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_id" varchar,
	"composite_id" uuid,
	"user_id" text,
	"file_id" varchar
);
--> statement-breakpoint
ALTER TABLE "files_to_messages" RENAME TO "messages_files";--> statement-breakpoint
DROP TABLE "files_to_agents";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "file_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "chunk_task_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "embedding_task_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_files" ADD CONSTRAINT "agents_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_files" ADD CONSTRAINT "agents_files_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_files" ADD CONSTRAINT "agents_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_knowledge_bases" ADD CONSTRAINT "agents_knowledge_bases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_knowledge_bases" ADD CONSTRAINT "agents_knowledge_bases_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_knowledge_bases" ADD CONSTRAINT "agents_knowledge_bases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "async_tasks" ADD CONSTRAINT "async_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_base_files" ADD CONSTRAINT "knowledge_base_files_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_base_files" ADD CONSTRAINT "knowledge_base_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_chunks" ADD CONSTRAINT "message_chunks_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_chunks" ADD CONSTRAINT "message_chunks_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_queries" ADD CONSTRAINT "message_queries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_queries" ADD CONSTRAINT "message_queries_embeddings_id_embeddings_id_fk" FOREIGN KEY ("embeddings_id") REFERENCES "public"."embeddings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_query_chunks" ADD CONSTRAINT "message_query_chunks_id_messages_id_fk" FOREIGN KEY ("id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_query_chunks" ADD CONSTRAINT "message_query_chunks_query_id_message_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."message_queries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_query_chunks" ADD CONSTRAINT "message_query_chunks_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages_files" ADD CONSTRAINT "messages_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages_files" ADD CONSTRAINT "messages_files_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunks" ADD CONSTRAINT "chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unstructured_chunks" ADD CONSTRAINT "unstructured_chunks_composite_id_chunks_id_fk" FOREIGN KEY ("composite_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unstructured_chunks" ADD CONSTRAINT "unstructured_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unstructured_chunks" ADD CONSTRAINT "unstructured_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_file_hash_global_files_hash_id_fk" FOREIGN KEY ("file_hash") REFERENCES "public"."global_files"("hash_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_chunk_task_id_async_tasks_id_fk" FOREIGN KEY ("chunk_task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_embedding_task_id_async_tasks_id_fk" FOREIGN KEY ("embedding_task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
