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
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "sender_id" text;--> statement-breakpoint
ALTER TABLE "agent_shares" DROP CONSTRAINT IF EXISTS "agent_shares_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_shares" ADD CONSTRAINT "agent_shares_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_shares_agent_id_unique" ON "agent_shares" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_shares_visibility_idx" ON "agent_shares" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_sender_id_idx" ON "topics" USING btree ("sender_id");
