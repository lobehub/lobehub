ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "trigger" varchar(255);--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefs_trigger_idx" ON "briefs" USING btree ("trigger");
