CREATE TABLE IF NOT EXISTS "rag_eval_dataset_records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rag_eval_dataset_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_id" integer NOT NULL,
	"ideal" text,
	"question" text,
	"reference_files" text[],
	"metadata" jsonb,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_eval_datasets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rag_eval_datasets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 30000 CACHE 1),
	"description" text,
	"name" text NOT NULL,
	"knowledge_base_id" text,
	"user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_eval_evaluations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rag_eval_evaluations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"description" text,
	"eval_records_url" text,
	"status" text,
	"error" jsonb,
	"dataset_id" integer NOT NULL,
	"knowledge_base_id" text,
	"language_model" text,
	"embedding_model" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_eval_evaluation_records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rag_eval_evaluation_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"question" text NOT NULL,
	"answer" text,
	"context" text[],
	"ideal" text,
	"status" text,
	"error" jsonb,
	"language_model" text,
	"embedding_model" text,
	"question_embedding_id" uuid,
	"duration" integer,
	"dataset_record_id" integer NOT NULL,
	"evaluation_id" integer NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_dataset_id_rag_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."rag_eval_datasets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_datasets" ADD CONSTRAINT "rag_eval_datasets_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_datasets" ADD CONSTRAINT "rag_eval_datasets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_dataset_id_rag_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."rag_eval_datasets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_question_embedding_id_embeddings_id_fk" FOREIGN KEY ("question_embedding_id") REFERENCES "public"."embeddings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_dataset_record_id_rag_eval_dataset_records_id_fk" FOREIGN KEY ("dataset_record_id") REFERENCES "public"."rag_eval_dataset_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_evaluation_id_rag_eval_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."rag_eval_evaluations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
