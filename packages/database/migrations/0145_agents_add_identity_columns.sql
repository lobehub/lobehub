ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "profile" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "society_id" text;
