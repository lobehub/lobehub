ALTER TABLE "task_comments" ADD COLUMN IF NOT EXISTS "parent_comment_id" text;--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_parent_comment_id_task_comments_id_fk";--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_parent_comment_id_task_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."task_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_parent_comment_id_idx" ON "task_comments" USING btree ("parent_comment_id");
