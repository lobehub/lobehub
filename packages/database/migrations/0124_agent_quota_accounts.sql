CREATE TABLE IF NOT EXISTS "agent_account_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"role" text DEFAULT 'pool' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"external_account_id" text,
	"email" text,
	"display_name" text,
	"organization_id" text,
	"plan_tier" text,
	"rate_limit_tier" text,
	"label" varchar(255),
	"credential_mode" text DEFAULT 'referenced' NOT NULL,
	"credentials" text,
	"credential_ref" jsonb,
	"token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_validated_at" timestamp with time zone,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_quota_calibrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"limit_type" text NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"capacity_usd" numeric(20, 6) NOT NULL,
	"capacity_tokens_equivalent" bigint,
	"model_mix" jsonb,
	"sample_count" integer NOT NULL,
	"confidence" numeric(20, 6),
	"method" text,
	"window_seconds" integer,
	"calibrated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_quota_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"device_id" uuid,
	"limit_type" text NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"resets_at" timestamp with time zone,
	"utilization" integer NOT NULL,
	"severity" text,
	"is_active" boolean,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_quota_usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"model" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"reasoning_tokens" integer,
	"cost_usd" numeric(20, 6),
	"cost_source" text,
	"message_id" text,
	"operation_id" text,
	"topic_id" text,
	"agent_id" text,
	"external_event_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_quota_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"limit_type" text NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"resets_at" timestamp with time zone NOT NULL,
	"window_start_at" timestamp with time zone NOT NULL,
	"window_seconds" integer NOT NULL,
	"peak_utilization" integer DEFAULT 0 NOT NULL,
	"last_utilization" integer,
	"rate_limited_at" timestamp with time zone,
	"observed_cost_usd" numeric(20, 6),
	"observed_tokens" bigint,
	"estimated_capacity_usd" numeric(20, 6),
	"contaminated" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_account_bindings" DROP CONSTRAINT IF EXISTS "agent_account_bindings_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_bindings" ADD CONSTRAINT "agent_account_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_bindings" DROP CONSTRAINT IF EXISTS "agent_account_bindings_account_id_agent_provider_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_bindings" ADD CONSTRAINT "agent_account_bindings_account_id_agent_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_bindings" DROP CONSTRAINT IF EXISTS "agent_account_bindings_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_bindings" ADD CONSTRAINT "agent_account_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_bindings" DROP CONSTRAINT IF EXISTS "agent_account_bindings_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_bindings" ADD CONSTRAINT "agent_account_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_provider_accounts" DROP CONSTRAINT IF EXISTS "agent_provider_accounts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_provider_accounts" ADD CONSTRAINT "agent_provider_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_provider_accounts" DROP CONSTRAINT IF EXISTS "agent_provider_accounts_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_provider_accounts" ADD CONSTRAINT "agent_provider_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_calibrations" DROP CONSTRAINT IF EXISTS "agent_quota_calibrations_account_id_agent_provider_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_calibrations" ADD CONSTRAINT "agent_quota_calibrations_account_id_agent_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_calibrations" DROP CONSTRAINT IF EXISTS "agent_quota_calibrations_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_calibrations" ADD CONSTRAINT "agent_quota_calibrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_calibrations" DROP CONSTRAINT IF EXISTS "agent_quota_calibrations_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_calibrations" ADD CONSTRAINT "agent_quota_calibrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_snapshots" DROP CONSTRAINT IF EXISTS "agent_quota_snapshots_account_id_agent_provider_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_snapshots" ADD CONSTRAINT "agent_quota_snapshots_account_id_agent_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_snapshots" DROP CONSTRAINT IF EXISTS "agent_quota_snapshots_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_snapshots" ADD CONSTRAINT "agent_quota_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_snapshots" DROP CONSTRAINT IF EXISTS "agent_quota_snapshots_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_snapshots" ADD CONSTRAINT "agent_quota_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_snapshots" DROP CONSTRAINT IF EXISTS "agent_quota_snapshots_device_id_devices_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_snapshots" ADD CONSTRAINT "agent_quota_snapshots_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" DROP CONSTRAINT IF EXISTS "agent_quota_usage_ledger_account_id_agent_provider_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" ADD CONSTRAINT "agent_quota_usage_ledger_account_id_agent_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_provider_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" DROP CONSTRAINT IF EXISTS "agent_quota_usage_ledger_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" ADD CONSTRAINT "agent_quota_usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" DROP CONSTRAINT IF EXISTS "agent_quota_usage_ledger_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" ADD CONSTRAINT "agent_quota_usage_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" DROP CONSTRAINT IF EXISTS "agent_quota_usage_ledger_message_id_messages_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" ADD CONSTRAINT "agent_quota_usage_ledger_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" DROP CONSTRAINT IF EXISTS "agent_quota_usage_ledger_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" ADD CONSTRAINT "agent_quota_usage_ledger_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" DROP CONSTRAINT IF EXISTS "agent_quota_usage_ledger_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" ADD CONSTRAINT "agent_quota_usage_ledger_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" DROP CONSTRAINT IF EXISTS "agent_quota_usage_ledger_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_usage_ledger" ADD CONSTRAINT "agent_quota_usage_ledger_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_windows" DROP CONSTRAINT IF EXISTS "agent_quota_windows_account_id_agent_provider_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_windows" ADD CONSTRAINT "agent_quota_windows_account_id_agent_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_windows" DROP CONSTRAINT IF EXISTS "agent_quota_windows_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_windows" ADD CONSTRAINT "agent_quota_windows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_quota_windows" DROP CONSTRAINT IF EXISTS "agent_quota_windows_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_quota_windows" ADD CONSTRAINT "agent_quota_windows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_account_bindings_agent_account_unique" ON "agent_account_bindings" USING btree ("agent_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_account_bindings_agent_pinned_unique" ON "agent_account_bindings" USING btree ("agent_id") WHERE "agent_account_bindings"."role" = 'pinned';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_account_bindings_agent_id_idx" ON "agent_account_bindings" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_account_bindings_account_id_idx" ON "agent_account_bindings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_account_bindings_user_id_idx" ON "agent_account_bindings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_account_bindings_workspace_id_idx" ON "agent_account_bindings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_provider_accounts_user_id_idx" ON "agent_provider_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_provider_accounts_workspace_id_idx" ON "agent_provider_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_provider_accounts_token_expires_at_idx" ON "agent_provider_accounts" USING btree ("token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_provider_accounts_identity_unique" ON "agent_provider_accounts" USING btree ("user_id","provider","external_account_id") WHERE "agent_provider_accounts"."external_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_calibrations_account_type_scope_idx" ON "agent_quota_calibrations" USING btree ("account_id","limit_type","scope_key","calibrated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_calibrations_workspace_id_idx" ON "agent_quota_calibrations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_snapshots_account_type_scope_idx" ON "agent_quota_snapshots" USING btree ("account_id","limit_type","scope_key","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_snapshots_account_captured_idx" ON "agent_quota_snapshots" USING btree ("account_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_snapshots_resets_at_idx" ON "agent_quota_snapshots" USING btree ("resets_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_snapshots_workspace_id_idx" ON "agent_quota_snapshots" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_usage_ledger_account_occurred_idx" ON "agent_quota_usage_ledger" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_usage_ledger_account_model_occurred_idx" ON "agent_quota_usage_ledger" USING btree ("account_id","model","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_usage_ledger_message_id_idx" ON "agent_quota_usage_ledger" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_usage_ledger_operation_id_idx" ON "agent_quota_usage_ledger" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_usage_ledger_workspace_id_idx" ON "agent_quota_usage_ledger" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_quota_usage_ledger_external_event_unique" ON "agent_quota_usage_ledger" USING btree ("external_event_id") WHERE "agent_quota_usage_ledger"."external_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_quota_windows_natural_key_unique" ON "agent_quota_windows" USING btree ("account_id","limit_type","scope_key","resets_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_windows_account_resets_idx" ON "agent_quota_windows" USING btree ("account_id","resets_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_windows_user_id_idx" ON "agent_quota_windows" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_windows_workspace_id_idx" ON "agent_quota_windows" USING btree ("workspace_id");