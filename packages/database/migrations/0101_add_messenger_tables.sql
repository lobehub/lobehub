CREATE TABLE IF NOT EXISTS "messenger_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"platform" varchar(50) NOT NULL,
	"tenant_id" varchar(255) DEFAULT '' NOT NULL,
	"platform_user_id" varchar(255) NOT NULL,
	"platform_username" text,
	"active_agent_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messenger_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(50) NOT NULL,
	"tenant_id" varchar(255) NOT NULL,
	"application_id" varchar(255) NOT NULL,
	"account_id" varchar(255),
	"credentials" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_expires_at" timestamp with time zone,
	"installed_by_user_id" text,
	"installed_by_platform_user_id" varchar(255),
	"revoked_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_bot_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(50) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"credentials" text NOT NULL,
	"application_id" varchar(255),
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connection_mode" varchar(20),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messenger_account_links" DROP CONSTRAINT IF EXISTS "messenger_account_links_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD CONSTRAINT "messenger_account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_account_links" DROP CONSTRAINT IF EXISTS "messenger_account_links_active_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD CONSTRAINT "messenger_account_links_active_agent_id_agents_id_fk" FOREIGN KEY ("active_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_installations" DROP CONSTRAINT IF EXISTS "messenger_installations_installed_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "messenger_installations" ADD CONSTRAINT "messenger_installations_installed_by_user_id_users_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_account_links_platform_tenant_user_unique" ON "messenger_account_links" USING btree ("platform","tenant_id","platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_account_links_user_platform_tenant_unique" ON "messenger_account_links" USING btree ("user_id","platform","tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messenger_account_links_active_agent_idx" ON "messenger_account_links" USING btree ("active_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_installations_platform_app_tenant_unique" ON "messenger_installations" USING btree ("platform","application_id","tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messenger_installations_platform_tenant_idx" ON "messenger_installations" USING btree ("platform","tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messenger_installations_token_expires_at_idx" ON "messenger_installations" USING btree ("token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "system_bot_providers_platform_unique" ON "system_bot_providers" USING btree ("platform");
