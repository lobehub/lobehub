CREATE TABLE IF NOT EXISTS "agent_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"kind" text NOT NULL,
	"identifier" text NOT NULL,
	"display_name" text,
	"provider" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"capabilities" jsonb NOT NULL,
	"credentials" text,
	"credential_hint" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"revoked_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_accounts" DROP CONSTRAINT IF EXISTS "agent_accounts_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_accounts" DROP CONSTRAINT IF EXISTS "agent_accounts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_accounts" DROP CONSTRAINT IF EXISTS "agent_accounts_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_accounts" ADD CONSTRAINT "agent_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_accounts_agent_kind_provider_identifier_unique" ON "agent_accounts" USING btree ("agent_id","kind","provider","identifier");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_accounts_provider_identifier_unique" ON "agent_accounts" USING btree ("provider","identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_accounts_agent_id_idx" ON "agent_accounts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_accounts_user_id_idx" ON "agent_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_accounts_workspace_id_idx" ON "agent_accounts" USING btree ("workspace_id");
