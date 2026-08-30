ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "share_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_share_id_idx" ON "topics" USING btree ("share_id");
