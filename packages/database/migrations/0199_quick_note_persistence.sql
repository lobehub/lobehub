CREATE TABLE IF NOT EXISTS "quick_note_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quick_note_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"author_user_id" text,
	"content" text NOT NULL,
	"editor_data" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quick_note_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quick_note_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"run_id" uuid NOT NULL,
	"source_history_id" varchar(255) NOT NULL,
	"kind" text NOT NULL,
	"preset" text,
	"payload" jsonb NOT NULL,
	"original_payload" jsonb NOT NULL,
	"decision_status" text DEFAULT 'pending' NOT NULL,
	"validity" text DEFAULT 'current' NOT NULL,
	"decided_at" timestamp with time zone,
	"dismiss_reason" text,
	"result_type" text,
	"result_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quick_note_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quick_note_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"source_history_id" varchar(255) NOT NULL,
	"run_id" uuid,
	"document_id" varchar(255),
	"resource_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"selector" jsonb,
	"role" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quick_note_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quick_note_id" text NOT NULL,
	"source_history_id" varchar(255) NOT NULL,
	"topic_id" text,
	"operation_id" text,
	"agent_id" text,
	"execution_config" jsonb,
	"kind" text NOT NULL,
	"trigger" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" jsonb,
	"input_snapshot" jsonb,
	"decision" jsonb,
	"summary" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quick_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"document_id" varchar(255) NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"collection" text,
	"location" text,
	"analyze_due_at" timestamp with time zone,
	"content_check_due_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "quick_note" jsonb;--> statement-breakpoint
ALTER TABLE "quick_note_comments" DROP CONSTRAINT IF EXISTS "quick_note_comments_quick_note_id_quick_notes_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_comments" ADD CONSTRAINT "quick_note_comments_quick_note_id_quick_notes_id_fk" FOREIGN KEY ("quick_note_id") REFERENCES "public"."quick_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_comments" DROP CONSTRAINT IF EXISTS "quick_note_comments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_comments" ADD CONSTRAINT "quick_note_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_comments" DROP CONSTRAINT IF EXISTS "quick_note_comments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_comments" ADD CONSTRAINT "quick_note_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_comments" DROP CONSTRAINT IF EXISTS "quick_note_comments_author_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_comments" ADD CONSTRAINT "quick_note_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_proposals" DROP CONSTRAINT IF EXISTS "quick_note_proposals_quick_note_id_quick_notes_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_proposals" ADD CONSTRAINT "quick_note_proposals_quick_note_id_quick_notes_id_fk" FOREIGN KEY ("quick_note_id") REFERENCES "public"."quick_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_proposals" DROP CONSTRAINT IF EXISTS "quick_note_proposals_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_proposals" ADD CONSTRAINT "quick_note_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_proposals" DROP CONSTRAINT IF EXISTS "quick_note_proposals_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_proposals" ADD CONSTRAINT "quick_note_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_proposals" DROP CONSTRAINT IF EXISTS "quick_note_proposals_run_id_quick_note_runs_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_proposals" ADD CONSTRAINT "quick_note_proposals_run_id_quick_note_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."quick_note_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_proposals" DROP CONSTRAINT IF EXISTS "quick_note_proposals_source_history_id_document_histories_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_proposals" ADD CONSTRAINT "quick_note_proposals_source_history_id_document_histories_id_fk" FOREIGN KEY ("source_history_id") REFERENCES "public"."document_histories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_resources" DROP CONSTRAINT IF EXISTS "quick_note_resources_quick_note_id_quick_notes_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_resources" ADD CONSTRAINT "quick_note_resources_quick_note_id_quick_notes_id_fk" FOREIGN KEY ("quick_note_id") REFERENCES "public"."quick_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_resources" DROP CONSTRAINT IF EXISTS "quick_note_resources_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_resources" ADD CONSTRAINT "quick_note_resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_resources" DROP CONSTRAINT IF EXISTS "quick_note_resources_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_resources" ADD CONSTRAINT "quick_note_resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_resources" DROP CONSTRAINT IF EXISTS "quick_note_resources_source_history_id_document_histories_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_resources" ADD CONSTRAINT "quick_note_resources_source_history_id_document_histories_id_fk" FOREIGN KEY ("source_history_id") REFERENCES "public"."document_histories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_resources" DROP CONSTRAINT IF EXISTS "quick_note_resources_run_id_quick_note_runs_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_resources" ADD CONSTRAINT "quick_note_resources_run_id_quick_note_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."quick_note_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_resources" DROP CONSTRAINT IF EXISTS "quick_note_resources_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_resources" ADD CONSTRAINT "quick_note_resources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_runs" DROP CONSTRAINT IF EXISTS "quick_note_runs_quick_note_id_quick_notes_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_runs" ADD CONSTRAINT "quick_note_runs_quick_note_id_quick_notes_id_fk" FOREIGN KEY ("quick_note_id") REFERENCES "public"."quick_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_runs" DROP CONSTRAINT IF EXISTS "quick_note_runs_source_history_id_document_histories_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_runs" ADD CONSTRAINT "quick_note_runs_source_history_id_document_histories_id_fk" FOREIGN KEY ("source_history_id") REFERENCES "public"."document_histories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_runs" DROP CONSTRAINT IF EXISTS "quick_note_runs_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_runs" ADD CONSTRAINT "quick_note_runs_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_runs" DROP CONSTRAINT IF EXISTS "quick_note_runs_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_runs" ADD CONSTRAINT "quick_note_runs_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_note_runs" DROP CONSTRAINT IF EXISTS "quick_note_runs_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "quick_note_runs" ADD CONSTRAINT "quick_note_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_notes" DROP CONSTRAINT IF EXISTS "quick_notes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "quick_notes" ADD CONSTRAINT "quick_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_notes" DROP CONSTRAINT IF EXISTS "quick_notes_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "quick_notes" ADD CONSTRAINT "quick_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_notes" DROP CONSTRAINT IF EXISTS "quick_notes_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "quick_notes" ADD CONSTRAINT "quick_notes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_comments_quick_note_id_idx" ON "quick_note_comments" USING btree ("quick_note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_comments_user_id_idx" ON "quick_note_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_comments_workspace_id_idx" ON "quick_note_comments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_comments_author_user_id_idx" ON "quick_note_comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_proposals_run_id_idx" ON "quick_note_proposals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_proposals_source_history_id_idx" ON "quick_note_proposals" USING btree ("source_history_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_proposals_decision_validity_idx" ON "quick_note_proposals" USING btree ("quick_note_id","decision_status","validity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_proposals_user_id_idx" ON "quick_note_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_proposals_workspace_id_idx" ON "quick_note_proposals" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quick_note_resources_identity_unique" ON "quick_note_resources" USING btree ("quick_note_id","source_history_id","resource_type","resource_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_resources_source_history_id_idx" ON "quick_note_resources" USING btree ("source_history_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_resources_run_id_idx" ON "quick_note_resources" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_resources_document_id_idx" ON "quick_note_resources" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_resources_user_id_idx" ON "quick_note_resources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_resources_workspace_id_idx" ON "quick_note_resources" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_runs_quick_note_id_idx" ON "quick_note_runs" USING btree ("quick_note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_runs_source_history_id_idx" ON "quick_note_runs" USING btree ("source_history_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_runs_topic_id_idx" ON "quick_note_runs" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_note_runs_agent_id_idx" ON "quick_note_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quick_note_runs_operation_id_unique" ON "quick_note_runs" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quick_note_runs_active_kind_unique" ON "quick_note_runs" USING btree ("quick_note_id","kind") WHERE "quick_note_runs"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quick_notes_document_id_unique" ON "quick_notes" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_notes_user_id_idx" ON "quick_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_notes_workspace_id_idx" ON "quick_notes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_notes_analyze_due_at_idx" ON "quick_notes" USING btree ("analyze_due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quick_notes_content_check_due_at_idx" ON "quick_notes" USING btree ("content_check_due_at");