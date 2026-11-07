CREATE TABLE IF NOT EXISTS "artboards" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"project_id" text,
	"acceptance_id" uuid,
	"origin_topic_id" text,
	"title" text NOT NULL,
	"description" text,
	"phase" text DEFAULT 'discuss' NOT NULL,
	"content" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_acceptance_id_acceptances_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboards" DROP CONSTRAINT IF EXISTS "artboards_origin_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "artboards" ADD CONSTRAINT "artboards_origin_topic_id_topics_id_fk" FOREIGN KEY ("origin_topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artboards_task_id_unique" ON "artboards" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_project_id_idx" ON "artboards" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_user_id_idx" ON "artboards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboards_workspace_id_idx" ON "artboards" USING btree ("workspace_id") WHERE "artboards"."workspace_id" IS NOT NULL;