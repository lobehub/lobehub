CREATE TABLE IF NOT EXISTS "document_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" varchar(255) NOT NULL,
	"user_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"permission" text DEFAULT 'read' NOT NULL,
	"page_view_count" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"expo_token" text NOT NULL,
	"device_id" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "editor_data" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_cost" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "cost" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "usage" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "provider" text;--> statement-breakpoint
ALTER TABLE "document_shares" DROP CONSTRAINT IF EXISTS "document_shares_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" DROP CONSTRAINT IF EXISTS "document_shares_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" DROP CONSTRAINT IF EXISTS "push_tokens_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_shares_document_id_unique" ON "document_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_shares_user_id_idx" ON "document_shares" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_tokens_device" ON "push_tokens" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_tokens_user" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_tokens_last_seen" ON "push_tokens" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_model_idx" ON "topics" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_provider_idx" ON "topics" USING btree ("provider");
