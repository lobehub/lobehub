ALTER TABLE "document_comments" ADD COLUMN IF NOT EXISTS "selection_anchor" jsonb;--> statement-breakpoint
ALTER TABLE "document_comments" DROP CONSTRAINT IF EXISTS "document_comments_reply_has_no_anchor";--> statement-breakpoint
ALTER TABLE "document_comments" ADD CONSTRAINT "document_comments_reply_has_no_anchor" CHECK ("document_comments"."parent_comment_id" IS NULL OR "document_comments"."selection_anchor" IS NULL);
