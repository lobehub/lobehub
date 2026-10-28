CREATE TABLE IF NOT EXISTS "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by_user_id" text,
	"role" text DEFAULT 'member' NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"workspace_id" text,
	"created_by_user_id" text,
	"name" varchar(255) NOT NULL,
	"origins" text[] NOT NULL,
	"acceptance_id" uuid,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_sites_name_not_empty" CHECK (length(btrim("project_sites"."name")) > 0),
	CONSTRAINT "project_sites_origins_not_empty" CHECK (cardinality("project_sites"."origins") > 0)
);
--> statement-breakpoint
ALTER TABLE "project_members" DROP CONSTRAINT IF EXISTS "project_members_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" DROP CONSTRAINT IF EXISTS "project_members_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" DROP CONSTRAINT IF EXISTS "project_members_added_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" DROP CONSTRAINT IF EXISTS "project_sites_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" DROP CONSTRAINT IF EXISTS "project_sites_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" DROP CONSTRAINT IF EXISTS "project_sites_created_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" DROP CONSTRAINT IF EXISTS "project_sites_acceptance_id_acceptances_id_fk";--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_members_project_user_unique" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_members_workspace_id_idx" ON "project_members" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_members_user_id_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sites_project_id_idx" ON "project_sites" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sites_workspace_id_idx" ON "project_sites" USING btree ("workspace_id");