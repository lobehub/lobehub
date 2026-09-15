CREATE TABLE IF NOT EXISTS "acceptance_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"author_user_id" text,
	"author_agent_id" text,
	"workspace_id" text,
	"parent_comment_id" text,
	"kind" text DEFAULT 'comment' NOT NULL,
	"anchor_type" text DEFAULT 'acceptance' NOT NULL,
	"context_run_id" uuid,
	"check_item_id" text,
	"evidence_id" uuid,
	"anchor_rect" jsonb,
	"content" text NOT NULL,
	"editor_data" jsonb,
	"attachments" jsonb,
	"client_id" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_acceptance_id_acceptances_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_author_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_author_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_parent_comment_id_acceptance_comments_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_parent_comment_id_acceptance_comments_id_fk" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."acceptance_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_context_run_id_verify_runs_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_context_run_id_verify_runs_id_fk" FOREIGN KEY ("context_run_id") REFERENCES "public"."verify_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_evidence_id_verify_evidence_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_evidence_id_verify_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."verify_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_resolved_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_comments_acceptance_id_author_user_id_client_id_unique" ON "acceptance_comments" USING btree ("acceptance_id","author_user_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_acceptance_id_created_at_id_idx" ON "acceptance_comments" USING btree ("acceptance_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_parent_comment_id_idx" ON "acceptance_comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_evidence_id_idx" ON "acceptance_comments" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_author_user_id_idx" ON "acceptance_comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_author_agent_id_idx" ON "acceptance_comments" USING btree ("author_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_workspace_id_idx" ON "acceptance_comments" USING btree ("workspace_id");