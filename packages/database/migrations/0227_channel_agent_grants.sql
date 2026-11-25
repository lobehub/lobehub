CREATE TABLE IF NOT EXISTS "channel_agent_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"grantee_member_id" uuid,
	"thread_id" text,
	"requested_by_member_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_agent_grants" DROP CONSTRAINT IF EXISTS "channel_agent_grants_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_agent_grants" ADD CONSTRAINT "channel_agent_grants_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_agent_grants" DROP CONSTRAINT IF EXISTS "channel_agent_grants_owner_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "channel_agent_grants" ADD CONSTRAINT "channel_agent_grants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_agent_grants" DROP CONSTRAINT IF EXISTS "channel_agent_grants_member_fk";--> statement-breakpoint
ALTER TABLE "channel_agent_grants" ADD CONSTRAINT "channel_agent_grants_member_fk" FOREIGN KEY ("channel_id","member_id") REFERENCES "public"."channel_members"("channel_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_agent_grants" DROP CONSTRAINT IF EXISTS "channel_agent_grants_grantee_fk";--> statement-breakpoint
ALTER TABLE "channel_agent_grants" ADD CONSTRAINT "channel_agent_grants_grantee_fk" FOREIGN KEY ("channel_id","grantee_member_id") REFERENCES "public"."channel_members"("channel_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_agent_grants" DROP CONSTRAINT IF EXISTS "channel_agent_grants_requester_fk";--> statement-breakpoint
ALTER TABLE "channel_agent_grants" ADD CONSTRAINT "channel_agent_grants_requester_fk" FOREIGN KEY ("channel_id","requested_by_member_id") REFERENCES "public"."channel_members"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_agent_grants" DROP CONSTRAINT IF EXISTS "channel_agent_grants_thread_fk";--> statement-breakpoint
ALTER TABLE "channel_agent_grants" ADD CONSTRAINT "channel_agent_grants_thread_fk" FOREIGN KEY ("channel_id","thread_id") REFERENCES "public"."channel_threads"("channel_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_agent_grants_live_scope_unique" ON "channel_agent_grants" USING btree ("member_id",coalesce("grantee_member_id"::text, ''),coalesce("thread_id", '')) WHERE "channel_agent_grants"."status" IN ('pending', 'approved');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_agent_grants_owner_status_idx" ON "channel_agent_grants" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_agent_grants_grantee_idx" ON "channel_agent_grants" USING btree ("grantee_member_id");