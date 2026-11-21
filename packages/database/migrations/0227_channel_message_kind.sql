ALTER TABLE "channel_jobs" ADD COLUMN IF NOT EXISTS "ask" jsonb;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
UPDATE "channel_messages" SET "kind" = 'contact' WHERE "kind" = 'text' AND "metadata" ? 'card';
