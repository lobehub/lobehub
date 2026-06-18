CREATE TABLE IF NOT EXISTS "agent_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"share_config" jsonb,
	"user_view_count" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(1000),
	"avatar" text,
	"primary_owner_id" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "usage" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "sender_id" text;--> statement-breakpoint
ALTER TABLE "agent_shares" DROP CONSTRAINT IF EXISTS "agent_shares_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_audit_logs" DROP CONSTRAINT IF EXISTS "workspace_audit_logs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "workspace_audit_logs" ADD CONSTRAINT "workspace_audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" DROP CONSTRAINT IF EXISTS "workspace_invitations_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" DROP CONSTRAINT IF EXISTS "workspace_invitations_inviter_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" DROP CONSTRAINT IF EXISTS "workspace_members_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" DROP CONSTRAINT IF EXISTS "workspace_members_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_primary_owner_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_primary_owner_id_users_id_fk" FOREIGN KEY ("primary_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_shares_agent_id_unique" ON "agent_shares" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_shares_visibility_idx" ON "agent_shares" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_audit_logs_workspace_id_idx" ON "workspace_audit_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_audit_logs_action_idx" ON "workspace_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_audit_logs_created_at_idx" ON "workspace_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_id_idx" ON "workspace_invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_email_idx" ON "workspace_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_token_idx" ON "workspace_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_user_id_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_slug_idx" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_primary_owner_id_idx" ON "workspaces" USING btree ("primary_owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_usage_cost_idx" ON "messages" USING btree ((("usage"->>'cost')::numeric));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_usage_total_tokens_idx" ON "messages" USING btree ((("usage"->>'totalTokens')::numeric));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_sender_id_idx" ON "topics" USING btree ("sender_id");
