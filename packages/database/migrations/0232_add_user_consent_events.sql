CREATE TABLE IF NOT EXISTS "user_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"workspace_id" text,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"before" jsonb,
	"after" jsonb,
	"notice" jsonb,
	"ip_address" text,
	"user_agent" text,
	"client" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_consent_events_resource_created_at_idx" ON "user_consent_events" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_consent_events_actor_created_at_idx" ON "user_consent_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_consent_events_workspace_created_at_idx" ON "user_consent_events" USING btree ("workspace_id","created_at") WHERE "user_consent_events"."workspace_id" IS NOT NULL;