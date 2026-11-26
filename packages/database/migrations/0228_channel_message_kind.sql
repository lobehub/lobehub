ALTER TABLE "channel_jobs" ADD COLUMN IF NOT EXISTS "ask" jsonb;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
UPDATE "channel_messages"
SET "kind" = CASE
  WHEN "metadata" ? 'card' THEN 'contact'
  WHEN "metadata" ? 'replyError' THEN 'error'
  ELSE 'deviceGrant'
END
WHERE "kind" = 'text' AND ("metadata" ? 'card' OR "metadata" ? 'replyError' OR "metadata" ? 'deviceGrant');
