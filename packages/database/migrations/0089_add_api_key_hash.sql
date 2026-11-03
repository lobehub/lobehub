ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_key_hash_unique";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash");
