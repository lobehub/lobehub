CREATE TABLE IF NOT EXISTS "topic_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"taxonomy_version" text NOT NULL,
	"category" text NOT NULL,
	"secondary_category" text,
	"intent" text,
	"outcome" text,
	"labels" jsonb,
	"model" text,
	"provider" text,
	"topic_model" text,
	"topic_provider" text,
	"total_tokens" integer,
	"total_input_tokens" integer,
	"total_output_tokens" integer,
	"total_cost" numeric(20, 6),
	"llm_calls" integer,
	"tool_calls" integer,
	"user_messages" integer,
	"assistant_messages" integer,
	"last_message_id" text,
	"last_message_updated_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topic_analyses" DROP CONSTRAINT IF EXISTS "topic_analyses_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "topic_analyses" ADD CONSTRAINT "topic_analyses_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_analyses" DROP CONSTRAINT IF EXISTS "topic_analyses_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "topic_analyses" ADD CONSTRAINT "topic_analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_analyses" DROP CONSTRAINT IF EXISTS "topic_analyses_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "topic_analyses" ADD CONSTRAINT "topic_analyses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topic_analyses_topic_version_unique" ON "topic_analyses" USING btree ("topic_id","taxonomy_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_analyses_user_id_created_at_idx" ON "topic_analyses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_analyses_workspace_id_created_at_idx" ON "topic_analyses" USING btree ("workspace_id","created_at") WHERE "topic_analyses"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_analyses_version_category_idx" ON "topic_analyses" USING btree ("taxonomy_version","category");