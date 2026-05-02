-- Idempotent: legacy 2-column unique indexes are dropped only if present
-- (a re-run on a DB already migrated has neither, hence IF EXISTS).
DROP INDEX IF EXISTS "messenger_account_links_platform_user_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "messenger_account_links_user_platform_unique";--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD COLUMN IF NOT EXISTS "tenant_id" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_account_links_platform_tenant_user_unique" ON "messenger_account_links" USING btree ("platform","tenant_id","platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_account_links_user_platform_tenant_unique" ON "messenger_account_links" USING btree ("user_id","platform","tenant_id");
