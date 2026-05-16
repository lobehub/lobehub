-- Custom SQL migration file, put your code below! --
-- Compatibility patch for legacy NextAuth-shaped databases.

-- users.email_verified used to be timestamp in older schemas; Better Auth expects boolean.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'email_verified'
      AND data_type IN ('timestamp without time zone', 'timestamp with time zone')
  ) THEN
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_tmp" boolean;
    UPDATE "users" SET "email_verified_tmp" = ("email_verified" IS NOT NULL) WHERE "email_verified_tmp" IS NULL;
    ALTER TABLE "users" DROP COLUMN "email_verified";
    ALTER TABLE "users" RENAME COLUMN "email_verified_tmp" TO "email_verified";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean DEFAULT false;--> statement-breakpoint
UPDATE "users" SET "email_verified" = false WHERE "email_verified" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_verified" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email_verified" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "normalized_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ban_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ban_expires" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_normalized_email_unique" ON "users" ("normalized_email");
--> statement-breakpoint

-- accounts table compatibility: keep legacy columns, add Better Auth columns.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "account_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "provider_id" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "password" text;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'provider'
  ) THEN
    UPDATE "accounts" SET "provider_id" = COALESCE("provider_id", "provider") WHERE "provider_id" IS NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'provider_account_id'
  ) THEN
    UPDATE "accounts" SET "account_id" = COALESCE("account_id", "provider_account_id") WHERE "account_id" IS NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'expires_at'
  ) THEN
    UPDATE "accounts"
    SET "access_token_expires_at" = to_timestamp("expires_at")
    WHERE "access_token_expires_at" IS NULL AND "expires_at" IS NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
UPDATE "accounts"
SET "id" = CONCAT('legacy_', SUBSTRING(md5(random()::text || clock_timestamp()::text), 1, 24))
WHERE "id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_id_unique" ON "accounts" ("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "accounts" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "id" text PRIMARY KEY NOT NULL,
  "impersonated_by" text,
  "ip_address" text,
  "token" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "user_agent" text,
  "user_id" text NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_token_unique') THEN
    ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_token_unique" UNIQUE ("token");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_sessions_user_id_users_id_fk') THEN
    ALTER TABLE "auth_sessions"
      ADD CONSTRAINT "auth_sessions_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_session_userId_idx" ON "auth_sessions" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "verifications" (
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "value" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verifications" ("identifier");
