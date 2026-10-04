CREATE TABLE IF NOT EXISTS "agent_number_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number_id" uuid,
	"agent_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount_usd" numeric(20, 6) NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"phone_number" text NOT NULL,
	"provider_number_id" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"area_code" text,
	"status" text DEFAULT 'pooled' NOT NULL,
	"agent_id" text,
	"user_id" text,
	"workspace_id" text,
	"account_id" uuid,
	"campaign_status" text DEFAULT 'none' NOT NULL,
	"campaign_id" text,
	"monthly_cost_usd" numeric(20, 6),
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone,
	"quarantine_until" timestamp with time zone,
	"released_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_number_charges" ADD CONSTRAINT "agent_number_charges_number_id_agent_phone_numbers_id_fk" FOREIGN KEY ("number_id") REFERENCES "public"."agent_phone_numbers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_number_charges" ADD CONSTRAINT "agent_number_charges_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_number_charges" ADD CONSTRAINT "agent_number_charges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_number_charges" ADD CONSTRAINT "agent_number_charges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_phone_numbers" ADD CONSTRAINT "agent_phone_numbers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_phone_numbers" ADD CONSTRAINT "agent_phone_numbers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_phone_numbers" ADD CONSTRAINT "agent_phone_numbers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_phone_numbers" ADD CONSTRAINT "agent_phone_numbers_account_id_agent_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_number_charges_external_id_unique" ON "agent_number_charges" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_number_charges_agent_occurred_idx" ON "agent_number_charges" USING btree ("agent_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_number_charges_user_id_idx" ON "agent_number_charges" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_phone_numbers_phone_number_live_unique" ON "agent_phone_numbers" USING btree ("phone_number") WHERE "agent_phone_numbers"."status" <> 'released';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_phone_numbers_status_area_code_idx" ON "agent_phone_numbers" USING btree ("provider","status","area_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_phone_numbers_agent_id_idx" ON "agent_phone_numbers" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_phone_numbers_quarantine_until_idx" ON "agent_phone_numbers" USING btree ("quarantine_until");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_accounts_phone_identifier_live_unique" ON "agent_accounts" USING btree ("identifier") WHERE "agent_accounts"."kind" = 'phone' AND "agent_accounts"."status" <> 'revoked';