ALTER TABLE "acceptance_comments" ADD COLUMN IF NOT EXISTS "source" jsonb;--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD COLUMN IF NOT EXISTS "metadata" jsonb;