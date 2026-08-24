CREATE TABLE IF NOT EXISTS "heterogeneous_agent_interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"interaction_kind" text NOT NULL,
	"review_token_hash" text NOT NULL,
	"review_context" jsonb NOT NULL,
	"sanitized_request" jsonb NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolution_request_id" uuid,
	"resolution_payload" jsonb,
	"resolution_actor_id" text,
	"resolving_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"producer_ack_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heterogeneous_agent_interventions_review_token_hash_check" CHECK ("heterogeneous_agent_interventions"."review_token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "heterogeneous_agent_interventions_version_check" CHECK ("heterogeneous_agent_interventions"."version" > 0),
	CONSTRAINT "heterogeneous_agent_interventions_resolution_bundle_check" CHECK (
        (
          "heterogeneous_agent_interventions"."resolution_request_id" IS NULL
          AND "heterogeneous_agent_interventions"."resolution_payload" IS NULL
          AND "heterogeneous_agent_interventions"."resolution_actor_id" IS NULL
          AND "heterogeneous_agent_interventions"."resolving_at" IS NULL
        )
        OR (
          "heterogeneous_agent_interventions"."resolution_request_id" IS NOT NULL
          AND "heterogeneous_agent_interventions"."resolution_payload" IS NOT NULL
          AND "heterogeneous_agent_interventions"."resolution_actor_id" IS NOT NULL
          AND "heterogeneous_agent_interventions"."resolving_at" IS NOT NULL
        )
      ),
	CONSTRAINT "heterogeneous_agent_interventions_producer_ack_check" CHECK ("heterogeneous_agent_interventions"."producer_ack_at" IS NULL OR "heterogeneous_agent_interventions"."resolved_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_live_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"activity_key" text NOT NULL,
	"operation_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"push_token" text NOT NULL,
	"apns_environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_live_activities_apns_environment_check" CHECK ("push_live_activities"."apns_environment" IN ('sandbox', 'production'))
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "apns_environment" text;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "live_activity_push_to_start_token" text;--> statement-breakpoint
ALTER TABLE "heterogeneous_agent_interventions" DROP CONSTRAINT IF EXISTS "heterogeneous_agent_interventions_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "heterogeneous_agent_interventions" ADD CONSTRAINT "heterogeneous_agent_interventions_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heterogeneous_agent_interventions" DROP CONSTRAINT IF EXISTS "heterogeneous_agent_interventions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "heterogeneous_agent_interventions" ADD CONSTRAINT "heterogeneous_agent_interventions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heterogeneous_agent_interventions" DROP CONSTRAINT IF EXISTS "heterogeneous_agent_interventions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "heterogeneous_agent_interventions" ADD CONSTRAINT "heterogeneous_agent_interventions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_live_activities" DROP CONSTRAINT IF EXISTS "push_live_activities_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "push_live_activities" ADD CONSTRAINT "push_live_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heterogeneous_agent_interventions_operation_tool_call_unique" ON "heterogeneous_agent_interventions" USING btree ("operation_id","tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heterogeneous_agent_interventions_review_token_hash_unique" ON "heterogeneous_agent_interventions" USING btree ("review_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "heterogeneous_agent_interventions_resolution_request_unique" ON "heterogeneous_agent_interventions" USING btree ("resolution_request_id") WHERE "heterogeneous_agent_interventions"."resolution_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heterogeneous_agent_interventions_owner_status_deadline_idx" ON "heterogeneous_agent_interventions" USING btree ("user_id","workspace_id","status","deadline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "heterogeneous_agent_interventions_status_deadline_idx" ON "heterogeneous_agent_interventions" USING btree ("status","deadline");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_live_activities_user_device_activity" ON "push_live_activities" USING btree ("user_id","device_id","activity_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_live_activities_user_activity" ON "push_live_activities" USING btree ("user_id","activity_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_live_activities_user_operation" ON "push_live_activities" USING btree ("user_id","operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_live_activities_last_seen" ON "push_live_activities" USING btree ("last_seen_at");--> statement-breakpoint
ALTER TABLE "push_tokens" DROP CONSTRAINT IF EXISTS "push_tokens_apns_environment_check";--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_apns_environment_check" CHECK ("push_tokens"."apns_environment" IS NULL OR "push_tokens"."apns_environment" IN ('sandbox', 'production')) NOT VALID;--> statement-breakpoint
ALTER TABLE "push_tokens" VALIDATE CONSTRAINT "push_tokens_apns_environment_check";
