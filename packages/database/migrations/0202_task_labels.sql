CREATE TABLE IF NOT EXISTS "task_label_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"label_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"parent_id" uuid,
	"is_group" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_label_links" DROP CONSTRAINT IF EXISTS "task_label_links_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "task_label_links" ADD CONSTRAINT "task_label_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_links" DROP CONSTRAINT IF EXISTS "task_label_links_label_id_task_labels_id_fk";--> statement-breakpoint
ALTER TABLE "task_label_links" ADD CONSTRAINT "task_label_links_label_id_task_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."task_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_links" DROP CONSTRAINT IF EXISTS "task_label_links_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_label_links" ADD CONSTRAINT "task_label_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_links" DROP CONSTRAINT IF EXISTS "task_label_links_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_label_links" ADD CONSTRAINT "task_label_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_labels" DROP CONSTRAINT IF EXISTS "task_labels_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_labels" DROP CONSTRAINT IF EXISTS "task_labels_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_labels" DROP CONSTRAINT IF EXISTS "task_labels_parent_id_task_labels_id_fk";--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_parent_id_task_labels_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."task_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_label_links_task_id_label_id_unique" ON "task_label_links" USING btree ("task_id","label_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_label_links_label_id_idx" ON "task_label_links" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_label_links_user_id_idx" ON "task_label_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_label_links_workspace_id_idx" ON "task_label_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_labels_user_id_idx" ON "task_labels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_labels_workspace_id_idx" ON "task_labels" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_labels_parent_id_idx" ON "task_labels" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_labels_user_id_name_unique" ON "task_labels" USING btree ("user_id",lower("name")) WHERE "task_labels"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_labels_workspace_id_name_unique" ON "task_labels" USING btree ("workspace_id",lower("name")) WHERE "task_labels"."workspace_id" IS NOT NULL;