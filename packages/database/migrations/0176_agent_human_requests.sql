CREATE TABLE IF NOT EXISTS "agent_human_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"topic_id" text,
	"operation_id" text,
	"tool_call_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"action" jsonb NOT NULL,
	"original_action" jsonb,
	"reason" text,
	"secret" jsonb,
	"recipient_key" text,
	"result" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_via" text,
	"notified_at" timestamp with time zone,
	"notify_attempts" integer DEFAULT 0 NOT NULL,
	"notify_attempted_at" timestamp with time zone,
	"notify_claim_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_human_requests" DROP CONSTRAINT IF EXISTS "agent_human_requests_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_human_requests" ADD CONSTRAINT "agent_human_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_human_requests" DROP CONSTRAINT IF EXISTS "agent_human_requests_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_human_requests" ADD CONSTRAINT "agent_human_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_human_requests" DROP CONSTRAINT IF EXISTS "agent_human_requests_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_human_requests" ADD CONSTRAINT "agent_human_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_human_requests" DROP CONSTRAINT IF EXISTS "agent_human_requests_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "agent_human_requests" ADD CONSTRAINT "agent_human_requests_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_human_requests_user_status_idx" ON "agent_human_requests" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_human_requests_agent_created_at_idx" ON "agent_human_requests" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_human_requests_topic_id_idx" ON "agent_human_requests" USING btree ("topic_id");
