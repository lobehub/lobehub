CREATE TABLE IF NOT EXISTS "agent_intervention_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resolution_request_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"source" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"actor_id" text NOT NULL,
	"scope" text NOT NULL,
	"selected_intervention_ids" jsonb NOT NULL,
	"expected_versions" jsonb NOT NULL,
	"expected_request_revision_hashes" jsonb NOT NULL,
	"expected_item_count" integer NOT NULL,
	"action" jsonb NOT NULL,
	"custom_execution_input_hash" varchar(64),
	"custom_execution_state" text,
	"custom_execution_attempt" integer,
	"custom_execution_lease_token" uuid,
	"custom_execution_lease_expires_at" timestamp with time zone,
	"custom_execution_result" jsonb,
	"remember_tool_key" text,
	"remember_effect_status" text,
	"original_arguments" text,
	"edited_arguments" text,
	"original_request_revision_hash" text,
	"edited_request_revision_hash" text,
	"argument_effect_status" text,
	"status" text DEFAULT 'resolving' NOT NULL,
	"resolving_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"continuation_started_at" timestamp with time zone,
	"producer_ack_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_intervention_resolutions_expected_item_count_check" CHECK ("agent_intervention_resolutions"."expected_item_count" > 0),
	CONSTRAINT "agent_intervention_resolutions_custom_execution_input_hash_check" CHECK ("agent_intervention_resolutions"."custom_execution_input_hash" IS NULL OR "agent_intervention_resolutions"."custom_execution_input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_intervention_resolutions_custom_execution_state_check" CHECK ((
        ("agent_intervention_resolutions"."custom_execution_state" IS NULL
          AND "agent_intervention_resolutions"."custom_execution_input_hash" IS NULL
          AND "agent_intervention_resolutions"."custom_execution_attempt" IS NULL
          AND "agent_intervention_resolutions"."custom_execution_lease_token" IS NULL
          AND "agent_intervention_resolutions"."custom_execution_lease_expires_at" IS NULL
          AND "agent_intervention_resolutions"."custom_execution_result" IS NULL)
        OR
        ("agent_intervention_resolutions"."custom_execution_state" = 'pending'
          AND "agent_intervention_resolutions"."custom_execution_attempt" = 0
          AND "agent_intervention_resolutions"."custom_execution_lease_token" IS NULL
          AND "agent_intervention_resolutions"."custom_execution_lease_expires_at" IS NULL
          AND "agent_intervention_resolutions"."custom_execution_result" IS NULL)
        OR
        ("agent_intervention_resolutions"."custom_execution_state" = 'executing'
          AND "agent_intervention_resolutions"."custom_execution_input_hash" IS NOT NULL
          AND "agent_intervention_resolutions"."custom_execution_attempt" > 0
          AND "agent_intervention_resolutions"."custom_execution_lease_token" IS NOT NULL
          AND "agent_intervention_resolutions"."custom_execution_lease_expires_at" IS NOT NULL
          AND "agent_intervention_resolutions"."custom_execution_result" IS NULL)
        OR
        ("agent_intervention_resolutions"."custom_execution_state" = 'completed'
          AND "agent_intervention_resolutions"."custom_execution_input_hash" IS NOT NULL
          AND "agent_intervention_resolutions"."custom_execution_attempt" > 0
          AND "agent_intervention_resolutions"."custom_execution_lease_token" IS NOT NULL
          AND "agent_intervention_resolutions"."custom_execution_lease_expires_at" IS NOT NULL
          AND "agent_intervention_resolutions"."custom_execution_result" IS NOT NULL)
      )),
	CONSTRAINT "agent_intervention_resolutions_custom_execution_parent_status_check" CHECK ("agent_intervention_resolutions"."custom_execution_state" NOT IN ('executing', 'completed') OR "agent_intervention_resolutions"."status" IN ('resolving', 'published', 'acknowledged', 'completed')),
	CONSTRAINT "agent_intervention_resolutions_version_check" CHECK ("agent_intervention_resolutions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_message_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"source" text NOT NULL,
	"provider" text,
	"interaction_kind" text NOT NULL,
	"surface" text NOT NULL,
	"system_action_eligibility" text NOT NULL,
	"approval_mode" text,
	"batch_id" text NOT NULL,
	"activity_key" text NOT NULL,
	"step_index" integer NOT NULL,
	"item_index" integer NOT NULL,
	"item_count" integer NOT NULL,
	"sealed" boolean DEFAULT false NOT NULL,
	"canonical_tool_key" text,
	"request_revision_hash" text NOT NULL,
	"allowed_actions" jsonb NOT NULL,
	"risk" jsonb,
	"review_token_hash" text NOT NULL,
	"review_context" jsonb NOT NULL,
	"sanitized_request" jsonb NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolution_id" uuid,
	"resolving_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"producer_ack_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_interventions_review_token_hash_check" CHECK ("agent_interventions"."review_token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_interventions_request_revision_hash_check" CHECK ("agent_interventions"."request_revision_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_interventions_step_index_check" CHECK ("agent_interventions"."step_index" >= 0),
	CONSTRAINT "agent_interventions_item_bounds_check" CHECK ("agent_interventions"."item_count" > 0 AND "agent_interventions"."item_index" >= 0 AND "agent_interventions"."item_index" < "agent_interventions"."item_count"),
	CONSTRAINT "agent_interventions_version_check" CHECK ("agent_interventions"."version" > 0)
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
ALTER TABLE "agent_intervention_resolutions" DROP CONSTRAINT IF EXISTS "agent_intervention_resolutions_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "agent_intervention_resolutions" ADD CONSTRAINT "agent_intervention_resolutions_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_intervention_resolutions" DROP CONSTRAINT IF EXISTS "agent_intervention_resolutions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_intervention_resolutions" ADD CONSTRAINT "agent_intervention_resolutions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_intervention_resolutions" DROP CONSTRAINT IF EXISTS "agent_intervention_resolutions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_intervention_resolutions" ADD CONSTRAINT "agent_intervention_resolutions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_interventions" DROP CONSTRAINT IF EXISTS "agent_interventions_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "agent_interventions" ADD CONSTRAINT "agent_interventions_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_interventions" DROP CONSTRAINT IF EXISTS "agent_interventions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_interventions" ADD CONSTRAINT "agent_interventions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_interventions" DROP CONSTRAINT IF EXISTS "agent_interventions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_interventions" ADD CONSTRAINT "agent_interventions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_interventions" DROP CONSTRAINT IF EXISTS "agent_interventions_resolution_id_agent_intervention_resolutions_id_fk";--> statement-breakpoint
ALTER TABLE "agent_interventions" ADD CONSTRAINT "agent_interventions_resolution_id_agent_intervention_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."agent_intervention_resolutions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_live_activities" DROP CONSTRAINT IF EXISTS "push_live_activities_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "push_live_activities" ADD CONSTRAINT "push_live_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_intervention_resolutions_request_unique" ON "agent_intervention_resolutions" USING btree ("resolution_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_intervention_resolutions_owner_batch_idx" ON "agent_intervention_resolutions" USING btree ("user_id","workspace_id","batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_intervention_resolutions_status_created_idx" ON "agent_intervention_resolutions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_interventions_operation_tool_call_unique" ON "agent_interventions" USING btree ("operation_id","tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_interventions_review_token_hash_unique" ON "agent_interventions" USING btree ("review_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_interventions_operation_batch_item_unique" ON "agent_interventions" USING btree ("operation_id","batch_id","item_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_interventions_owner_activity_item_unique" ON "agent_interventions" USING btree ("user_id","activity_key","item_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_interventions_owner_status_deadline_idx" ON "agent_interventions" USING btree ("user_id","workspace_id","status","deadline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_interventions_owner_batch_idx" ON "agent_interventions" USING btree ("user_id","workspace_id","batch_id","item_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_interventions_activity_key_idx" ON "agent_interventions" USING btree ("user_id","activity_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_interventions_status_deadline_idx" ON "agent_interventions" USING btree ("status","deadline");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_live_activities_user_device_activity" ON "push_live_activities" USING btree ("user_id","device_id","activity_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_live_activities_user_activity" ON "push_live_activities" USING btree ("user_id","activity_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_live_activities_user_operation" ON "push_live_activities" USING btree ("user_id","operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_live_activities_last_seen" ON "push_live_activities" USING btree ("last_seen_at");--> statement-breakpoint
ALTER TABLE "push_tokens" DROP CONSTRAINT IF EXISTS "push_tokens_apns_environment_check";--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_apns_environment_check" CHECK ("push_tokens"."apns_environment" IS NULL OR "push_tokens"."apns_environment" IN ('sandbox', 'production')) NOT VALID;--> statement-breakpoint
ALTER TABLE "push_tokens" VALIDATE CONSTRAINT "push_tokens_apns_environment_check";
