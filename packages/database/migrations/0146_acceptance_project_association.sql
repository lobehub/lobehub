CREATE TABLE IF NOT EXISTS "project_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"work_id" text NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptances" ADD COLUMN IF NOT EXISTS "project_id" text;--> statement-breakpoint
ALTER TABLE "project_works" DROP CONSTRAINT IF EXISTS "project_works_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_works" DROP CONSTRAINT IF EXISTS "project_works_work_id_works_id_fk";--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_works" DROP CONSTRAINT IF EXISTS "project_works_added_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_works" DROP CONSTRAINT IF EXISTS "project_works_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_works_project_id_work_id_unique" ON "project_works" USING btree ("project_id","work_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_works_project_id_sort_order_idx" ON "project_works" USING btree ("project_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_works_work_id_idx" ON "project_works" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_works_workspace_id_idx" ON "project_works" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "acceptances" DROP CONSTRAINT IF EXISTS "acceptances_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptances_project_id_idx" ON "acceptances" USING btree ("project_id");