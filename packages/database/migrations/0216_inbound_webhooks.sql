CREATE TABLE IF NOT EXISTS "inbound_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"kind" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"agent_id" text NOT NULL,
	"topic_id" text,
	"instructions" text,
	"secret" text,
	"verification" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connector_id" uuid,
	"dedupe_key" text,
	"next_maintenance_at" timestamp with time zone,
	"maintenance_failures" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_error" text,
	"wake_count" integer DEFAULT 0 NOT NULL,
	"wake_window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_webhooks" DROP CONSTRAINT IF EXISTS "inbound_webhooks_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" DROP CONSTRAINT IF EXISTS "inbound_webhooks_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" DROP CONSTRAINT IF EXISTS "inbound_webhooks_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" DROP CONSTRAINT IF EXISTS "inbound_webhooks_topic_id_topics_id_fk";
--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" DROP CONSTRAINT IF EXISTS "inbound_webhooks_connector_id_user_connectors_id_fk";
--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_connector_id_user_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."user_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_webhooks_user_kind_dedupe_unique" ON "inbound_webhooks" USING btree ("user_id","kind","dedupe_key") WHERE "inbound_webhooks"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhooks_next_maintenance_idx" ON "inbound_webhooks" USING btree ("next_maintenance_at") WHERE "inbound_webhooks"."next_maintenance_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhooks_user_idx" ON "inbound_webhooks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhooks_workspace_idx" ON "inbound_webhooks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhooks_topic_idx" ON "inbound_webhooks" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhooks_agent_idx" ON "inbound_webhooks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhooks_connector_idx" ON "inbound_webhooks" USING btree ("connector_id");