CREATE TABLE IF NOT EXISTS "two_factor" (
  "backup_codes" text NOT NULL,
  "id" text PRIMARY KEY NOT NULL,
  "secret" text NOT NULL,
  "user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_number" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'two_factor_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "two_factor"
      ADD CONSTRAINT "two_factor_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_secret_idx" ON "two_factor" USING btree ("secret");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factor_user_id_idx" ON "two_factor" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "accounts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_session_userId_idx" ON "auth_sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verifications" USING btree ("identifier");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique') THEN
    -- Normalize empty emails so the unique constraint can be created safely
    UPDATE "users" SET "email" = NULL WHERE "email" = '';
    ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_number_unique') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_phone_number_unique" UNIQUE ("phone_number");
  END IF;
END $$;
