CREATE TABLE "generation_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"generation_topic_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"width" integer,
	"height" integer,
	"ratio" varchar(64),
	"config" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"cover_url" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"generation_batch_id" varchar(64) NOT NULL,
	"async_task_id" uuid,
	"file_id" text,
	"seed" integer,
	"asset" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_batches" ADD CONSTRAINT "generation_batches_generation_topic_id_generation_topics_id_fk" FOREIGN KEY ("generation_topic_id") REFERENCES "public"."generation_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_topics" ADD CONSTRAINT "generation_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_generation_batch_id_generation_batches_id_fk" FOREIGN KEY ("generation_batch_id") REFERENCES "public"."generation_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_async_task_id_async_tasks_id_fk" FOREIGN KEY ("async_task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;