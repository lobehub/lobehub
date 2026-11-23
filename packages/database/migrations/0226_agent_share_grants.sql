CREATE TABLE IF NOT EXISTS "agent_share_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"source" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_share_grants" DROP CONSTRAINT IF EXISTS "agent_share_grants_share_id_agent_shares_id_fk";--> statement-breakpoint
ALTER TABLE "agent_share_grants" ADD CONSTRAINT "agent_share_grants_share_id_agent_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."agent_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_share_grants" DROP CONSTRAINT IF EXISTS "agent_share_grants_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_share_grants" ADD CONSTRAINT "agent_share_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_share_grants_share_user_unique" ON "agent_share_grants" USING btree ("share_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_share_grants_user_id_idx" ON "agent_share_grants" USING btree ("user_id");
