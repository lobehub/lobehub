CREATE TABLE "document_rewrite_requests" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"document_id" varchar(255) NOT NULL,
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
	"last_command_id" text,
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
	CONSTRAINT "document_rewrite_requests_error_message_length_check" CHECK ("document_rewrite_requests"."error_message" IS NULL OR char_length("document_rewrite_requests"."error_message") <= 16384),
	CONSTRAINT "document_rewrite_requests_attempt_positive" CHECK ("document_rewrite_requests"."attempt" > 0),
	CONSTRAINT "document_rewrite_requests_version_positive" CHECK ("document_rewrite_requests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" ADD CONSTRAINT "document_rewrite_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" ADD CONSTRAINT "document_rewrite_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" ADD CONSTRAINT "document_rewrite_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_rewrite_requests_document_status_idx" ON "document_rewrite_requests" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX "document_rewrite_requests_status_next_attempt_idx" ON "document_rewrite_requests" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "document_rewrite_requests_agent_status_idx" ON "document_rewrite_requests" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "document_rewrite_requests_claim_lease_idx" ON "document_rewrite_requests" USING btree ("claim_owner","lease_expires_at");--> statement-breakpoint
CREATE INDEX "document_rewrite_requests_user_created_at_idx" ON "document_rewrite_requests" USING btree ("requested_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "document_rewrite_requests_target_node_ids_gin_idx" ON "document_rewrite_requests" USING gin ("target_node_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "document_rewrite_requests_active_target_unique" ON "document_rewrite_requests" USING btree ("document_id","target_key") WHERE "document_rewrite_requests"."target_key" IS NOT NULL AND "document_rewrite_requests"."status" IN ('queued', 'connecting', 'syncing', 'thinking', 'writing', 'awaiting_review', 'cancel_requested', 'canceled_after_write', 'retry_wait');