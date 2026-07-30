CREATE TABLE "member_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_member_id" text NOT NULL,
	"limit_usd" numeric(10, 6) NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"used_usd" numeric(10, 6) DEFAULT 0 NOT NULL,
	"openrouter_key_id" text,
	"openrouter_key_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_access_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"scope" text NOT NULL,
	"org_member_id" text,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"identifier_type" text NOT NULL,
	"identifier_value" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_by_user_id" text,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"wallet_balance_toman" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"org_member_id" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"amount_toman" bigint NOT NULL,
	"gateway_ref_id" text,
	"description" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_budgets" ADD CONSTRAINT "member_budgets_org_member_id_organization_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_access_rules" ADD CONSTRAINT "model_access_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_access_rules" ADD CONSTRAINT "model_access_rules_org_member_id_organization_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_org_member_id_organization_members_id_fk" FOREIGN KEY ("org_member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_budgets_org_member_uidx" ON "member_budgets" USING btree ("org_member_id");--> statement-breakpoint
CREATE INDEX "model_access_rules_org_id_idx" ON "model_access_rules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "model_access_rules_org_member_id_idx" ON "model_access_rules" USING btree ("org_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invites_token_uidx" ON "organization_invites" USING btree ("token");--> statement-breakpoint
CREATE INDEX "organization_invites_org_id_idx" ON "organization_invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "organization_invites_identifier_idx" ON "organization_invites" USING btree ("identifier_type","identifier_value");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_uidx" ON "organization_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_id_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_members_org_id_idx" ON "organization_members" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_unique_active_owner_idx" ON "organization_members" USING btree ("org_id") WHERE "organization_members"."role" = 'owner' AND "organization_members"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizations_owner_user_id_idx" ON "organizations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_user_id_uidx" ON "platform_admins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_logs_org_id_idx" ON "usage_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_logs_org_member_id_idx" ON "usage_logs" USING btree ("org_member_id");--> statement-breakpoint
CREATE INDEX "usage_logs_created_at_idx" ON "usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wallet_transactions_org_id_idx" ON "wallet_transactions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "wallet_transactions_created_at_idx" ON "wallet_transactions" USING btree ("created_at");