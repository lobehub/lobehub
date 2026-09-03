CREATE TABLE IF NOT EXISTS "document_comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"mentioned_user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"parent_comment_id" uuid,
	"reply_to_comment_id" uuid,
	"author_user_id" text,
	"workspace_id" text NOT NULL,
	"content" text NOT NULL,
	"editor_data" jsonb,
	"client_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_comment_mentions" DROP CONSTRAINT IF EXISTS "document_comment_mentions_comment_id_document_comments_id_fk";--> statement-breakpoint
ALTER TABLE "document_comment_mentions" ADD CONSTRAINT "document_comment_mentions_comment_id_document_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."document_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comment_mentions" DROP CONSTRAINT IF EXISTS "document_comment_mentions_mentioned_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_comment_mentions" ADD CONSTRAINT "document_comment_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comment_mentions" DROP CONSTRAINT IF EXISTS "document_comment_mentions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_comment_mentions" ADD CONSTRAINT "document_comment_mentions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" DROP CONSTRAINT IF EXISTS "document_comments_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" DROP CONSTRAINT IF EXISTS "document_comments_parent_comment_id_document_comments_id_fk";--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_parent_comment_id_document_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."document_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" DROP CONSTRAINT IF EXISTS "document_comments_reply_to_comment_id_document_comments_id_fk";--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_reply_to_comment_id_document_comments_id_fk" FOREIGN KEY ("reply_to_comment_id") REFERENCES "public"."document_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" DROP CONSTRAINT IF EXISTS "document_comments_author_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_comments" DROP CONSTRAINT IF EXISTS "document_comments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_comment_mentions_comment_id_mentioned_user_id_unique" ON "document_comment_mentions" USING btree ("comment_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comment_mentions_mentioned_user_id_created_at_idx" ON "document_comment_mentions" USING btree ("mentioned_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comment_mentions_workspace_id_idx" ON "document_comment_mentions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_comments_document_id_author_user_id_client_id_unique" ON "document_comments" USING btree ("document_id","author_user_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comments_parent_comment_id_created_at_id_idx" ON "document_comments" USING btree ("parent_comment_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comments_reply_to_comment_id_idx" ON "document_comments" USING btree ("reply_to_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comments_document_id_created_at_id_idx" ON "document_comments" USING btree ("document_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comments_author_user_id_idx" ON "document_comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comments_workspace_id_idx" ON "document_comments" USING btree ("workspace_id");
