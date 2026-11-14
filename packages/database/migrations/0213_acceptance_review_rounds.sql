CREATE TABLE IF NOT EXISTS "acceptance_review_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"route_key" text NOT NULL,
	"page_meta" jsonb,
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
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"project_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"task_id" text,
	"last_mark_seq" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD COLUMN IF NOT EXISTS "review_mark_id" uuid;--> statement-breakpoint
ALTER TABLE "acceptance_review_marks" DROP CONSTRAINT IF EXISTS "acceptance_review_marks_review_id_acceptance_reviews_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_review_marks" ADD CONSTRAINT "acceptance_review_marks_review_id_acceptance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."acceptance_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_review_marks" DROP CONSTRAINT IF EXISTS "acceptance_review_marks_screenshot_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_review_marks" ADD CONSTRAINT "acceptance_review_marks_screenshot_file_id_files_id_fk" FOREIGN KEY ("screenshot_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_site_id_project_sites_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_site_id_project_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."project_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_reviews" DROP CONSTRAINT IF EXISTS "acceptance_reviews_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_reviews" ADD CONSTRAINT "acceptance_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_review_marks_review_id_client_id_unique" ON "acceptance_review_marks" USING btree ("review_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_review_marks_review_id_seq_unique" ON "acceptance_review_marks" USING btree ("review_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_review_marks_route_key_review_id_idx" ON "acceptance_review_marks" USING btree ("route_key","review_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_site_id_created_at_idx" ON "acceptance_reviews" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_task_id_idx" ON "acceptance_reviews" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_user_id_idx" ON "acceptance_reviews" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_reviews_workspace_id_idx" ON "acceptance_reviews" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_reviews_one_draft_per_user_unique" ON "acceptance_reviews" USING btree ("site_id","user_id") WHERE "acceptance_reviews"."status" = 'draft';--> statement-breakpoint
ALTER TABLE "acceptance_comments" DROP CONSTRAINT IF EXISTS "acceptance_comments_review_mark_id_acceptance_review_marks_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_comments" ADD CONSTRAINT "acceptance_comments_review_mark_id_acceptance_review_marks_id_fk" FOREIGN KEY ("review_mark_id") REFERENCES "public"."acceptance_review_marks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_comments_review_mark_id_idx" ON "acceptance_comments" USING btree ("review_mark_id");
