-- Aico final remediation: integer micro-USD, period budgets, single active org,
-- ciphertext rename, unique trial phone fingerprint, outbox/tomb/renewal tables.
-- Production has not launched; convert numeric USD → micro-USD via * 1000000.

--> statement-breakpoint
-- Organizations wallet: numeric USD → micro-USD bigint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "wallet_balance_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'wallet_balance_usd'
  ) THEN
    UPDATE "organizations"
    SET "wallet_balance_micro_usd" = ROUND(COALESCE("wallet_balance_usd", 0) * 1000000)::bigint;
    ALTER TABLE "organizations" DROP COLUMN "wallet_balance_usd";
  END IF;
END $$;--> statement-breakpoint

-- Member budgets: rebuild period funding columns
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "period_amount_micro_usd" bigint;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'member_budgets' AND column_name = 'limit_usd'
  ) THEN
    UPDATE "member_budgets"
    SET "period_amount_micro_usd" = ROUND(COALESCE("limit_usd", 0) * 1000000)::bigint
    WHERE "period_amount_micro_usd" IS NULL;
  END IF;
END $$;--> statement-breakpoint
UPDATE "member_budgets" SET "period_amount_micro_usd" = 0 WHERE "period_amount_micro_usd" IS NULL;--> statement-breakpoint
ALTER TABLE "member_budgets" ALTER COLUMN "period_amount_micro_usd" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "openrouter_limit_reset" text;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "current_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "next_renewal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "renewal_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "reserved_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "settled_usage_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "refunded_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "pending_period" text;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "pending_period_amount_micro_usd" bigint;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "last_sync_status" text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_budgets" ADD COLUMN IF NOT EXISTS "last_sync_error" text;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'member_budgets' AND column_name = 'used_usd'
  ) THEN
    UPDATE "member_budgets"
    SET "settled_usage_micro_usd" = ROUND(COALESCE("used_usd", 0) * 1000000)::bigint;
    UPDATE "member_budgets"
    SET "reserved_micro_usd" = COALESCE("period_amount_micro_usd", 0)
    WHERE "reserved_micro_usd" = 0 AND "period_amount_micro_usd" > 0;
    ALTER TABLE "member_budgets" DROP COLUMN "used_usd";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'member_budgets' AND column_name = 'limit_usd'
  ) THEN
    ALTER TABLE "member_budgets" DROP COLUMN "limit_usd";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'member_budgets' AND column_name = 'openrouter_key_hash'
  ) THEN
    ALTER TABLE "member_budgets" RENAME COLUMN "openrouter_key_hash" TO "openrouter_key_ciphertext";
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_budgets_next_renewal_at_idx" ON "member_budgets" USING btree ("next_renewal_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_budgets_renewal_status_idx" ON "member_budgets" USING btree ("renewal_status");--> statement-breakpoint

-- User wallets
ALTER TABLE "user_wallets" ADD COLUMN IF NOT EXISTS "balance_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_wallets' AND column_name = 'balance_usd'
  ) THEN
    UPDATE "user_wallets"
    SET "balance_micro_usd" = ROUND(COALESCE("balance_usd", 0) * 1000000)::bigint;
    ALTER TABLE "user_wallets" DROP COLUMN "balance_usd";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD COLUMN IF NOT EXISTS "preferred_billing_source" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD COLUMN IF NOT EXISTS "preferred_organization_id" text;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD COLUMN IF NOT EXISTS "frozen_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_wallets' AND column_name = 'openrouter_key_hash'
  ) THEN
    ALTER TABLE "user_wallets" RENAME COLUMN "openrouter_key_hash" TO "openrouter_key_ciphertext";
  END IF;
END $$;--> statement-breakpoint

-- Wallet transactions
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "amount_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wallet_transactions' AND column_name = 'amount_usd'
  ) THEN
    UPDATE "wallet_transactions"
    SET "amount_micro_usd" = ROUND(COALESCE("amount_usd", 0) * 1000000)::bigint;
    ALTER TABLE "wallet_transactions" DROP COLUMN "amount_usd";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "fx_rate_toman_per_usd" bigint;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wallet_transactions' AND column_name = 'fx_rate'
  ) THEN
    UPDATE "wallet_transactions"
    SET "fx_rate_toman_per_usd" = ROUND(COALESCE("fx_rate", 0))::bigint
    WHERE "fx_rate" IS NOT NULL;
    ALTER TABLE "wallet_transactions" DROP COLUMN "fx_rate";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "org_member_id" text;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "renewal_batch_id" text;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_transactions_renewal_batch_id_idx" ON "wallet_transactions" USING btree ("renewal_batch_id");--> statement-breakpoint

-- Usage logs
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "cost_micro_usd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage_logs' AND column_name = 'cost_usd'
  ) THEN
    UPDATE "usage_logs"
    SET "cost_micro_usd" = ROUND(COALESCE("cost_usd", 0) * 1000000)::bigint;
    ALTER TABLE "usage_logs" DROP COLUMN "cost_usd";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "billing_source" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "settlement_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
-- Ensure user_id is NOT NULL when fully mapped (0132 repair for upgraded DBs)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage_logs' AND column_name = 'user_id' AND is_nullable = 'YES'
  ) THEN
    IF EXISTS (SELECT 1 FROM "usage_logs" WHERE "user_id" IS NULL) THEN
      RAISE EXCEPTION 'AICO_MIGRATION_0136: usage_logs.user_id has NULL rows — resolve before NOT NULL';
    END IF;
    ALTER TABLE "usage_logs" ALTER COLUMN "user_id" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint

-- Trial config
ALTER TABLE "platform_trial_config" ADD COLUMN IF NOT EXISTS "trial_budget_micro_usd" bigint DEFAULT 1000000 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_trial_config' AND column_name = 'trial_budget_usd'
  ) THEN
    UPDATE "platform_trial_config"
    SET "trial_budget_micro_usd" = ROUND(COALESCE("trial_budget_usd", 1) * 1000000)::bigint;
    ALTER TABLE "platform_trial_config" DROP COLUMN "trial_budget_usd";
  END IF;
END $$;--> statement-breakpoint
UPDATE "platform_trial_config" SET "enabled" = false;--> statement-breakpoint
ALTER TABLE "platform_trial_config" ALTER COLUMN "enabled" SET DEFAULT false;--> statement-breakpoint

-- Unique trial phone fingerprint
DROP INDEX IF EXISTS "user_trials_phone_fingerprint_idx";--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT "phone_fingerprint" FROM "user_trials" GROUP BY 1 HAVING COUNT(*) > 1
    ) dups
  ) THEN
    RAISE EXCEPTION 'AICO_MIGRATION_0136: duplicate user_trials.phone_fingerprint — resolve before UNIQUE';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_trials_phone_fingerprint_uidx" ON "user_trials" USING btree ("phone_fingerprint");--> statement-breakpoint

-- Single active organization membership per user
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT "user_id" FROM "organization_members"
      WHERE "status" = 'active'
      GROUP BY 1 HAVING COUNT(*) > 1
    ) dups
  ) THEN
    RAISE EXCEPTION 'AICO_MIGRATION_0136: users with multiple active organization memberships — resolve before UNIQUE';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_unique_active_user_idx"
  ON "organization_members" USING btree ("user_id")
  WHERE "status" = 'active';--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "left_at" timestamp with time zone;--> statement-breakpoint

-- Renewal batches
CREATE TABLE IF NOT EXISTS "aico_renewal_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "batch_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "gross_required_micro_usd" bigint DEFAULT 0 NOT NULL,
  "refunded_micro_usd" bigint DEFAULT 0 NOT NULL,
  "shortfall_micro_usd" bigint DEFAULT 0 NOT NULL,
  "member_budget_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aico_renewal_batches_batch_key_uidx" ON "aico_renewal_batches" USING btree ("batch_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_renewal_batches_org_id_idx" ON "aico_renewal_batches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_renewal_batches_status_idx" ON "aico_renewal_batches" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "aico_renewal_batches" ADD CONSTRAINT "aico_renewal_batches_org_id_organizations_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Key outbox
CREATE TABLE IF NOT EXISTS "aico_key_outbox" (
  "id" text PRIMARY KEY NOT NULL,
  "action" text NOT NULL,
  "org_id" text,
  "org_member_id" text,
  "user_id" text,
  "openrouter_key_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "last_error" text,
  "alerted_at" timestamp with time zone,
  "payload" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_key_outbox_status_next_attempt_idx" ON "aico_key_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_key_outbox_org_member_id_idx" ON "aico_key_outbox" USING btree ("org_member_id");--> statement-breakpoint

-- Account tombs
CREATE TABLE IF NOT EXISTS "aico_account_tombs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "anonymized_email_fingerprint" text,
  "anonymized_phone_fingerprint" text,
  "frozen_personal_micro_usd" bigint DEFAULT 0 NOT NULL,
  "deleted_at" timestamp with time zone NOT NULL,
  "deleted_by_user_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aico_account_tombs_user_id_uidx" ON "aico_account_tombs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_account_tombs_deleted_at_idx" ON "aico_account_tombs" USING btree ("deleted_at");--> statement-breakpoint

-- Master monitor
CREATE TABLE IF NOT EXISTS "aico_master_monitor_state" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "status" text DEFAULT 'unknown' NOT NULL,
  "available_credit_micro_usd" bigint,
  "observed_burn_micro_usd_per_day" bigint,
  "low_credit_threshold_micro_usd" bigint DEFAULT 100000000 NOT NULL,
  "projected_exhaustion_at" timestamp with time zone,
  "last_successful_check_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "aico_master_monitor_state" ("id", "status")
VALUES ('default', 'unknown')
ON CONFLICT ("id") DO NOTHING;
