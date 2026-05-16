CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" text PRIMARY KEY,
  "name" varchar(256) NOT NULL,
  "key" varchar(256),
  "enabled" boolean DEFAULT true,
  "expires_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "user_id" text NOT NULL,
  "accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_key_hash_unique";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash");
