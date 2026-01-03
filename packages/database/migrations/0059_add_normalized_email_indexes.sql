ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "normalized_email" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_normalized_email_unique_idx" ON "users" USING btree ("normalized_email");--> statement-breakpoint
