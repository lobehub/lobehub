ALTER TABLE "acceptances" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptances_archived_at_idx" ON "acceptances" USING btree ("archived_at");
