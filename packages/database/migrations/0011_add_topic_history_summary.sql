ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "history_summary" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
