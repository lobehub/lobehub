CREATE TABLE IF NOT EXISTS "document_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_likes" DROP CONSTRAINT IF EXISTS "document_likes_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_likes" ADD CONSTRAINT "document_likes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_likes" DROP CONSTRAINT IF EXISTS "document_likes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_likes" ADD CONSTRAINT "document_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_likes" DROP CONSTRAINT IF EXISTS "document_likes_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_likes" ADD CONSTRAINT "document_likes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_likes_document_id_user_id_unique" ON "document_likes" USING btree ("document_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_likes_document_id_created_at_idx" ON "document_likes" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_likes_user_id_idx" ON "document_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_likes_workspace_id_idx" ON "document_likes" USING btree ("workspace_id");
