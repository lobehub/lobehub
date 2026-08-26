CREATE TABLE IF NOT EXISTS "agent_share_run_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"visitor_user_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_share_run_reservations" DROP CONSTRAINT IF EXISTS "agent_share_run_reservations_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_share_run_reservations" ADD CONSTRAINT "agent_share_run_reservations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_share_run_reservations" DROP CONSTRAINT IF EXISTS "agent_share_run_reservations_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_share_run_reservations" ADD CONSTRAINT "agent_share_run_reservations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_share_run_reservations_agent_id_idx" ON "agent_share_run_reservations" USING btree ("agent_id");
