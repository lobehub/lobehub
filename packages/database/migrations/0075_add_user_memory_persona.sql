CREATE TABLE IF NOT EXISTS "user_memory_persona_document_histories" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" text,
	"persona_id" varchar(255),
	"profile" varchar(255) DEFAULT 'default' NOT NULL,
	"snapshot_persona" text,
	"snapshot_tagline" text,
	"reasoning" text,
	"diff_persona" text,
	"diff_tagline" text,
	"snapshot" text,
	"summary" text,
	"edited_by" varchar(255) DEFAULT 'agent',
	"memory_ids" jsonb,
	"source_ids" jsonb,
	"metadata" jsonb,
	"previous_version" integer,
	"next_version" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memory_persona_documents" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" text,
	"profile" varchar(255) DEFAULT 'default' NOT NULL,
	"tagline" text,
	"persona" text,
	"memory_ids" jsonb,
	"source_ids" jsonb,
	"metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_memory_persona_document_histories" DROP CONSTRAINT IF EXISTS "user_memory_persona_document_histories_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_memory_persona_document_histories" ADD CONSTRAINT "user_memory_persona_document_histories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_persona_document_histories" DROP CONSTRAINT IF EXISTS "user_memory_persona_document_histories_persona_id_user_memory_persona_documents_id_fk";--> statement-breakpoint
ALTER TABLE "user_memory_persona_document_histories" ADD CONSTRAINT "user_memory_persona_document_histories_persona_id_user_memory_persona_documents_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."user_memory_persona_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_persona_document_histories_persona_id_index" ON "user_memory_persona_document_histories" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_persona_document_histories_user_id_index" ON "user_memory_persona_document_histories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_persona_document_histories_profile_index" ON "user_memory_persona_document_histories" USING btree ("profile");--> statement-breakpoint
ALTER TABLE "user_memory_persona_documents" DROP CONSTRAINT IF EXISTS "user_memory_persona_documents_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_memory_persona_documents" ADD CONSTRAINT "user_memory_persona_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_persona_documents_user_id_profile_unique" ON "user_memory_persona_documents" USING btree ("user_id","profile");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_persona_documents_user_id_index" ON "user_memory_persona_documents" USING btree ("user_id");
