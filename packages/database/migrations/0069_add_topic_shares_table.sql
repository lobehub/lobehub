CREATE TABLE IF NOT EXISTS "topic_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"user_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"page_view_count" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "topic_shares" ADD CONSTRAINT "topic_shares_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "topic_shares" ADD CONSTRAINT "topic_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topic_shares_topic_id_unique" ON "topic_shares" USING btree ("topic_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_shares_user_id_idx" ON "topic_shares" USING btree ("user_id");
