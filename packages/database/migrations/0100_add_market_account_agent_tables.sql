CREATE TABLE IF NOT EXISTS "market_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"lobe_user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"user_name" varchar(100),
	"namespace" varchar(100) NOT NULL,
	"avatar_url" text,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"follower_count" integer DEFAULT 0 NOT NULL,
	"following_count" integer DEFAULT 0 NOT NULL,
	"type" text DEFAULT 'user' NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_agent_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"agent_id" integer NOT NULL,
	"event" text NOT NULL,
	"source" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_agent_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"version" varchar(64) DEFAULT '1.0.0' NOT NULL,
	"version_number" integer NOT NULL,
	"is_latest" boolean DEFAULT true NOT NULL,
	"is_validated" boolean DEFAULT false NOT NULL,
	"a2a_protocol_version" text,
	"avatar" text,
	"category" text,
	"changelog" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"default_input_modes" text[] DEFAULT '{}',
	"default_output_modes" text[] DEFAULT '{}',
	"description" text DEFAULT '' NOT NULL,
	"documentation_url" text,
	"editor_data" jsonb DEFAULT '{}'::jsonb,
	"extensions" jsonb DEFAULT '[]'::jsonb,
	"has_push_notifications" boolean DEFAULT false,
	"has_state_transition_history" boolean DEFAULT false,
	"has_streaming" boolean DEFAULT false,
	"interfaces" jsonb DEFAULT '[]'::jsonb,
	"name" text NOT NULL,
	"preferred_transport" text,
	"security_requirements" jsonb DEFAULT '[]'::jsonb,
	"security_schemes" jsonb DEFAULT '{}'::jsonb,
	"skills" jsonb DEFAULT '[]'::jsonb,
	"summary" text DEFAULT '' NOT NULL,
	"supports_authenticated_extended_card" boolean DEFAULT false,
	"tags" text[] DEFAULT '{}',
	"token_usage" integer DEFAULT 0 NOT NULL,
	"url" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" varchar(128) NOT NULL,
	"owner_id" integer NOT NULL,
	"name" text NOT NULL,
	"homepage" text,
	"status" text DEFAULT 'unpublished' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"current_version_id" integer,
	"forked_from_agent_id" integer,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"install_count" integer DEFAULT 0 NOT NULL,
	"fork_count" integer DEFAULT 0 NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"favorite_count" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_agents" DROP CONSTRAINT IF EXISTS "market_agents_owner_id_market_accounts_id_fk";
ALTER TABLE "market_agents" ADD CONSTRAINT "market_agents_owner_id_market_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."market_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_agent_versions" DROP CONSTRAINT IF EXISTS "market_agent_versions_agent_id_market_agents_id_fk";
ALTER TABLE "market_agent_versions" ADD CONSTRAINT "market_agent_versions_agent_id_market_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."market_agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_agent_events" DROP CONSTRAINT IF EXISTS "market_agent_events_account_id_market_accounts_id_fk";
ALTER TABLE "market_agent_events" ADD CONSTRAINT "market_agent_events_account_id_market_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."market_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_agent_events" DROP CONSTRAINT IF EXISTS "market_agent_events_agent_id_market_agents_id_fk";
ALTER TABLE "market_agent_events" ADD CONSTRAINT "market_agent_events_agent_id_market_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."market_agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_accounts_lobe_user_id_unique" ON "market_accounts" USING btree ("lobe_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_accounts_email_unique" ON "market_accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_accounts_namespace_unique" ON "market_accounts" USING btree ("namespace");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_accounts_user_name_unique" ON "market_accounts" USING btree ("user_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agent_events_agent_id_idx" ON "market_agent_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agent_events_account_id_idx" ON "market_agent_events" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_agent_versions_agent_id_version_number_unique" ON "market_agent_versions" USING btree ("agent_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agent_versions_agent_id_idx" ON "market_agent_versions" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_agents_identifier_unique" ON "market_agents" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agents_owner_id_idx" ON "market_agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agents_status_visibility_idx" ON "market_agents" USING btree ("status","visibility");
