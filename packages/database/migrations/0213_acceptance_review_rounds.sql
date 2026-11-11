CREATE TABLE IF NOT EXISTS "acceptance_review_marks" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"page_url" text NOT NULL,
	"route" text NOT NULL,
	"rect_document" jsonb NOT NULL,
	"rect_viewport" jsonb NOT NULL,
	"scroll" jsonb NOT NULL,
	"viewport" jsonb NOT NULL,
	"regions" jsonb,
	"region_refs" jsonb,
	"targets" jsonb,
	"sketch" jsonb,
	"context" jsonb,
	"screenshot_file_id" text,
	"content" text NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acceptance_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"author_user_id" text,
	"workspace_id" text,
	"project_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"page_url" text NOT NULL,
	"route" text NOT NULL,
	"page_title" text,
	"title" text,
	"summary" text,
	"agent_id" text,
	"last_mark_seq" integer DEFAULT 0 NOT NULL,
	"task_id" text,
	"delivery_acceptance_id" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD COLUMN IF NOT EXISTS "review_mark_id" text;--> statement-breakpoint
ALTER TABLE "acceptance_review_marks" DROP CONSTRAINT IF EXISTS "acceptance_review_marks_review_id_acceptance_reviews_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_review_marks" ADD CONSTRAINT "acceptance_review_marks_review_id_acceptance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."acceptance_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_review_marks" DROP CONSTRAINT IF EXISTS "acceptance_review_marks_screenshot_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_review_marks" ADD CONSTRAINT "acceptance_review_marks_screenshot_file_id_files_id_fk" FOREIGN KEY ("screenshot_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_acceptance_id_acceptances_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_author_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_delivery_acceptance_id_acceptances_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_delivery_acceptance_id_acceptances_id_fk" FOREIGN KEY ("delivery_acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_review_marks_review_id_client_id_unique" ON "acceptance_review_marks" USING btree ("review_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_review_marks_review_id_seq_unique" ON "acceptance_review_marks" USING btree ("review_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_acceptance_route_created_idx" ON "acceptance_reviews" USING btree ("acceptance_id","route","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_task_id_idx" ON "acceptance_reviews" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_delivery_acceptance_id_idx" ON "acceptance_reviews" USING btree ("delivery_acceptance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_author_user_id_idx" ON "acceptance_reviews" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_workspace_id_idx" ON "acceptance_reviews" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_reviews_one_draft_per_author_unique" ON "acceptance_reviews" USING btree ("acceptance_id","author_user_id") WHERE "acceptance_reviews"."status" = 'draft';--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_review_mark_id_acceptance_review_marks_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_review_mark_id_acceptance_review_marks_id_fk" FOREIGN KEY ("review_mark_id") REFERENCES "public"."acceptance_review_marks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_review_mark_id_idx" ON "acceptance_comments" USING btree ("review_mark_id");