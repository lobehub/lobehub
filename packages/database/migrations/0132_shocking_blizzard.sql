CREATE TABLE IF NOT EXISTS "organization_team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"org_member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_trial_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"duration_days" integer DEFAULT 3 NOT NULL,
	"allowed_model_ids" text DEFAULT '[]' NOT NULL,
	"max_requests" integer,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_abuse_blocklist" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint_type" text NOT NULL,
	"fingerprint_value" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_trials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phone_fingerprint" text NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"balance_toman" bigint DEFAULT 0 NOT NULL,
	"balance_usd" numeric(14, 6) DEFAULT 0 NOT NULL,
	"openrouter_key_id" text,
	"openrouter_key_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_budgets" ALTER COLUMN "period" SET DEFAULT 'total';--> statement-breakpoint
ALTER TABLE "usage_logs" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ALTER COLUMN "org_member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_access_rules" ADD COLUMN IF NOT EXISTS "team_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "wallet_balance_usd" numeric(14, 6) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
-- Backfill before NOT NULL. Unmapped rows are reported by ops; do not invent fake user ids.
UPDATE "usage_logs" SET "user_id" = 'unmapped' WHERE "user_id" IS NULL AND false;--> statement-breakpoint
-- Only enforce NOT NULL when every row is mapped (empty table or backfilled).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "usage_logs" WHERE "user_id" IS NULL) THEN
    ALTER TABLE "usage_logs" ALTER COLUMN "user_id" SET NOT NULL;
  ELSE
    RAISE EXCEPTION 'AICO_MIGRATION_0132: usage_logs.user_id has NULL rows -- resolve unmapped usage before continuing';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "amount_usd" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(14, 4);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organization_team_members" ADD CONSTRAINT "organization_team_members_team_id_organization_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organization_team_members" ADD CONSTRAINT "organization_team_members_org_member_id_organization_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "organization_teams" ADD CONSTRAINT "organization_teams_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_trial_config" ADD CONSTRAINT "platform_trial_config_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_trials" ADD CONSTRAINT "user_trials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_team_members_team_member_uidx" ON "organization_team_members" USING btree ("team_id","org_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_team_members_member_uidx" ON "organization_team_members" USING btree ("org_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_team_members_team_id_idx" ON "organization_team_members" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_teams_org_slug_uidx" ON "organization_teams" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_teams_org_id_idx" ON "organization_teams" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_teams_unique_default_idx" ON "organization_teams" USING btree ("org_id") WHERE "organization_teams"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_abuse_blocklist_type_value_uidx" ON "trial_abuse_blocklist" USING btree ("fingerprint_type","fingerprint_value");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_trials_user_id_uidx" ON "user_trials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_trials_phone_fingerprint_idx" ON "user_trials" USING btree ("phone_fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_trials_status_idx" ON "user_trials" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_wallets_user_id_uidx" ON "user_wallets" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "model_access_rules" ADD CONSTRAINT "model_access_rules_team_id_organization_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."organization_teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_access_rules_team_id_idx" ON "model_access_rules" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_logs_user_id_idx" ON "usage_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_transactions_user_id_idx" ON "wallet_transactions" USING btree ("user_id");
