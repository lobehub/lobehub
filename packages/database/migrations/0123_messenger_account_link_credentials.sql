ALTER TABLE "messenger_account_links" ADD COLUMN IF NOT EXISTS "application_id" varchar(255);--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD COLUMN IF NOT EXISTS "credentials" text;
