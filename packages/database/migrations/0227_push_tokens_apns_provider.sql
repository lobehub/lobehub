ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'expo' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "bundle_id" text;