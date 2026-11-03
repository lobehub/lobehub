CREATE TABLE IF NOT EXISTS "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'active',
	"topic_id" text NOT NULL,
	"source_message_id" text NOT NULL,
	"parent_thread_id" text,
	"user_id" text NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now(),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "thread_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "threads" ADD CONSTRAINT "threads_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "threads" ADD CONSTRAINT "threads_parent_thread_id_threads_id_fk" FOREIGN KEY ("parent_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
