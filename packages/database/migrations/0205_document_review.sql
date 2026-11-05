CREATE TABLE IF NOT EXISTS "document_review_check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text DEFAULT 'unchecked' NOT NULL,
	"explanation" text,
	"evidence" jsonb,
	"suggestion" jsonb,
	"checked_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_review_impacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"trigger" text,
	"reason" text NOT NULL,
	"confidence" real,
	"source_anchor" jsonb,
	"related_anchor" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_review_rule_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_review_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"instruction" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_review_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"rule_set_id" text,
	"title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"base_history_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_review_check_results" DROP CONSTRAINT IF EXISTS "document_review_check_results_session_id_document_review_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_check_results" ADD CONSTRAINT "document_review_check_results_session_id_document_review_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."document_review_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_check_results" DROP CONSTRAINT IF EXISTS "document_review_check_results_rule_id_document_review_rules_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_check_results" ADD CONSTRAINT "document_review_check_results_rule_id_document_review_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."document_review_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_check_results" DROP CONSTRAINT IF EXISTS "document_review_check_results_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_check_results" ADD CONSTRAINT "document_review_check_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_impacts" DROP CONSTRAINT IF EXISTS "document_review_impacts_session_id_document_review_sessions_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_impacts" ADD CONSTRAINT "document_review_impacts_session_id_document_review_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."document_review_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_impacts" DROP CONSTRAINT IF EXISTS "document_review_impacts_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_impacts" ADD CONSTRAINT "document_review_impacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_rule_sets" DROP CONSTRAINT IF EXISTS "document_review_rule_sets_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_rule_sets" ADD CONSTRAINT "document_review_rule_sets_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_rule_sets" DROP CONSTRAINT IF EXISTS "document_review_rule_sets_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_rule_sets" ADD CONSTRAINT "document_review_rule_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_rule_sets" DROP CONSTRAINT IF EXISTS "document_review_rule_sets_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_rule_sets" ADD CONSTRAINT "document_review_rule_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_rule_sets" DROP CONSTRAINT IF EXISTS "document_review_rule_sets_confirmed_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_rule_sets" ADD CONSTRAINT "document_review_rule_sets_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_rules" DROP CONSTRAINT IF EXISTS "document_review_rules_rule_set_id_document_review_rule_sets_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_rules" ADD CONSTRAINT "document_review_rules_rule_set_id_document_review_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."document_review_rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_rules" DROP CONSTRAINT IF EXISTS "document_review_rules_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_rules" ADD CONSTRAINT "document_review_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_sessions" DROP CONSTRAINT IF EXISTS "document_review_sessions_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_sessions" ADD CONSTRAINT "document_review_sessions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_sessions" DROP CONSTRAINT IF EXISTS "document_review_sessions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_sessions" ADD CONSTRAINT "document_review_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_sessions" DROP CONSTRAINT IF EXISTS "document_review_sessions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_sessions" ADD CONSTRAINT "document_review_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_review_sessions" DROP CONSTRAINT IF EXISTS "document_review_sessions_rule_set_id_document_review_rule_sets_id_fk";--> statement-breakpoint
ALTER TABLE "document_review_sessions" ADD CONSTRAINT "document_review_sessions_rule_set_id_document_review_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."document_review_rule_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_review_check_results_session_id_rule_id_unique" ON "document_review_check_results" USING btree ("session_id","rule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_check_results_rule_id_idx" ON "document_review_check_results" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_check_results_workspace_id_idx" ON "document_review_check_results" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_impacts_session_id_sort_order_idx" ON "document_review_impacts" USING btree ("session_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_impacts_workspace_id_idx" ON "document_review_impacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_rule_sets_document_id_idx" ON "document_review_rule_sets" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_rule_sets_workspace_id_idx" ON "document_review_rule_sets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_rule_sets_user_id_idx" ON "document_review_rule_sets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_rule_sets_confirmed_by_user_id_idx" ON "document_review_rule_sets" USING btree ("confirmed_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_rules_rule_set_id_sort_order_idx" ON "document_review_rules" USING btree ("rule_set_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_rules_workspace_id_idx" ON "document_review_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_sessions_document_id_created_at_idx" ON "document_review_sessions" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_sessions_workspace_id_idx" ON "document_review_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_sessions_rule_set_id_idx" ON "document_review_sessions" USING btree ("rule_set_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_sessions_user_id_idx" ON "document_review_sessions" USING btree ("user_id");