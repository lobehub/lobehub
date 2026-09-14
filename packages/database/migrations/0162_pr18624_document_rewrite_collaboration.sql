CREATE TABLE IF NOT EXISTS "document_annotations" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"document_id" varchar(255) NOT NULL,
	"user_id" text NOT NULL,
	"author" jsonb,
	"kind" text DEFAULT 'comment' NOT NULL,
	"payload" jsonb,
	"quoted_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"anchor_metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_annotations_status_check" CHECK ("document_annotations"."status" IN ('active', 'resolved', 'orphaned', 'deleted')),
	CONSTRAINT "document_annotations_version_positive" CHECK ("document_annotations"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_collaboration_states" (
	"document_id" varchar(255) PRIMARY KEY NOT NULL,
	"room_id" varchar(255) NOT NULL,
	"workspace_id" text,
	"user_id" text NOT NULL,
	"room_revision" integer DEFAULT 0 NOT NULL,
	"state_vector" text DEFAULT '' NOT NULL,
	"snapshot_update" text,
	"version_token" varchar(255) NOT NULL,
	"document_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_rewrite_requests" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"document_id" varchar(255) NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"parent_request_id" varchar(255),
	"turn_index" integer DEFAULT 1 NOT NULL,
	"workspace_id" text,
	"requested_by_user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"operation_id" text,
	"topic_id" text,
	"tool_call_id" text,
	"instruction" text NOT NULL,
	"selection" jsonb NOT NULL,
	"quoted_text" text DEFAULT '' NOT NULL,
	"target_key" varchar(767),
	"target_node_ids" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"generation_id" text,
	"model" text,
	"provider" text,
	"requested_model" text,
	"requested_provider" text,
	"last_command_id" text,
	"output_text" text,
	"progress" jsonb,
	"error_code" varchar(128),
	"error_message" text,
	"cancel_requested_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"claim_owner" varchar(255),
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_rewrite_requests_status_check" CHECK ("document_rewrite_requests"."status" IN ('queued', 'connecting', 'syncing', 'thinking', 'writing', 'awaiting_review', 'applied', 'rejected', 'cancel_requested', 'canceled', 'canceled_after_write', 'retry_wait', 'stale', 'failed')),
	CONSTRAINT "document_rewrite_requests_instruction_length_check" CHECK (char_length("document_rewrite_requests"."instruction") <= 32768),
	CONSTRAINT "document_rewrite_requests_quoted_text_length_check" CHECK (char_length("document_rewrite_requests"."quoted_text") <= 32768),
	CONSTRAINT "document_rewrite_requests_output_text_length_check" CHECK ("document_rewrite_requests"."output_text" IS NULL OR char_length("document_rewrite_requests"."output_text") <= 32768),
	CONSTRAINT "document_rewrite_requests_error_message_length_check" CHECK ("document_rewrite_requests"."error_message" IS NULL OR char_length("document_rewrite_requests"."error_message") <= 16384),
	CONSTRAINT "document_rewrite_requests_progress_size_check" CHECK ("document_rewrite_requests"."progress" IS NULL OR pg_column_size("document_rewrite_requests"."progress") <= 32768),
	CONSTRAINT "document_rewrite_requests_attempt_positive" CHECK ("document_rewrite_requests"."attempt" > 0),
	CONSTRAINT "document_rewrite_requests_turn_index_positive" CHECK ("document_rewrite_requests"."turn_index" > 0),
	CONSTRAINT "document_rewrite_requests_version_positive" CHECK ("document_rewrite_requests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "document_histories" ADD COLUMN IF NOT EXISTS "request_id" text;--> statement-breakpoint
ALTER TABLE "document_histories" ADD COLUMN IF NOT EXISTS "source" text;--> statement-breakpoint
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotations" DROP CONSTRAINT IF EXISTS "document_annotations_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_collaboration_states" DROP CONSTRAINT IF EXISTS "document_collaboration_states_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_collaboration_states" ADD CONSTRAINT "document_collaboration_states_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_collaboration_states" DROP CONSTRAINT IF EXISTS "document_collaboration_states_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_collaboration_states" ADD CONSTRAINT "document_collaboration_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_collaboration_states" DROP CONSTRAINT IF EXISTS "document_collaboration_states_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_collaboration_states" ADD CONSTRAINT "document_collaboration_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" DROP CONSTRAINT IF EXISTS "document_rewrite_requests_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" ADD CONSTRAINT "document_rewrite_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" DROP CONSTRAINT IF EXISTS "document_rewrite_requests_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" ADD CONSTRAINT "document_rewrite_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" DROP CONSTRAINT IF EXISTS "document_rewrite_requests_requested_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" ADD CONSTRAINT "document_rewrite_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_annotations_document_id_id_unique" ON "document_annotations" USING btree ("document_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_annotations_document_id_created_at_id_idx" ON "document_annotations" USING btree ("document_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_annotations_document_id_status_idx" ON "document_annotations" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_annotations_user_id_idx" ON "document_annotations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_collaboration_states_room_id_idx" ON "document_collaboration_states" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_collaboration_states_workspace_id_idx" ON "document_collaboration_states" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_collaboration_states_user_id_idx" ON "document_collaboration_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_rewrite_requests_document_status_idx" ON "document_rewrite_requests" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_rewrite_requests_status_next_attempt_idx" ON "document_rewrite_requests" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_rewrite_requests_agent_status_idx" ON "document_rewrite_requests" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_rewrite_requests_claim_lease_idx" ON "document_rewrite_requests" USING btree ("claim_owner","lease_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_rewrite_requests_user_created_at_idx" ON "document_rewrite_requests" USING btree ("requested_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_rewrite_requests_document_session_turn_idx" ON "document_rewrite_requests" USING btree ("document_id","session_id","turn_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_rewrite_requests_parent_idx" ON "document_rewrite_requests" USING btree ("parent_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_rewrite_requests_target_node_ids_gin_idx" ON "document_rewrite_requests" USING gin ("target_node_ids");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_histories_document_source_request_unique" ON "document_histories" USING btree ("document_id","source","request_id") WHERE "document_histories"."request_id" IS NOT NULL;
