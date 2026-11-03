CREATE TABLE IF NOT EXISTS "document_chunks" (
	"document_id" varchar(30) NOT NULL,
	"chunk_id" uuid NOT NULL,
	"page_index" integer,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_document_id_chunk_id_pk" PRIMARY KEY("document_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" varchar(30) PRIMARY KEY NOT NULL,
	"title" text,
	"content" text,
	"file_type" varchar(255) NOT NULL,
	"filename" text,
	"total_char_count" integer NOT NULL,
	"total_line_count" integer NOT NULL,
	"metadata" jsonb,
	"pages" jsonb,
	"source_type" text NOT NULL,
	"source" text NOT NULL,
	"file_id" text,
	"user_id" text NOT NULL,
	"client_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topic_documents" (
	"document_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_documents_document_id_topic_id_pk" PRIMARY KEY("document_id","topic_id")
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_documents" ADD CONSTRAINT "topic_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_documents" ADD CONSTRAINT "topic_documents_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_documents" ADD CONSTRAINT "topic_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_source_idx" ON "documents" USING btree ("source");--> statement-breakpoint
CREATE INDEX "documents_file_type_idx" ON "documents" USING btree ("file_type");--> statement-breakpoint
CREATE INDEX "documents_file_id_idx" ON "documents" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_client_id_user_id_unique" ON "documents" USING btree ("client_id","user_id");
