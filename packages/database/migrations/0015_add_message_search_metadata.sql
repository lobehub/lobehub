ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "search" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "metadata" jsonb;