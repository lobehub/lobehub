CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"duration_ms" integer,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"redelivery_of" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"url" text NOT NULL,
	"description" text,
	"secret" text NOT NULL,
	"secret_hint" text NOT NULL,
	"events" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT IF EXISTS "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT IF EXISTS "webhook_deliveries_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT IF EXISTS "webhook_deliveries_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" DROP CONSTRAINT IF EXISTS "webhook_endpoints_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" DROP CONSTRAINT IF EXISTS "webhook_endpoints_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_created_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_user_id_idx" ON "webhook_deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_workspace_id_idx" ON "webhook_deliveries" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_endpoints_user_id_idx" ON "webhook_endpoints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_endpoints_workspace_id_idx" ON "webhook_endpoints" USING btree ("workspace_id");