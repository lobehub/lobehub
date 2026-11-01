CREATE TABLE IF NOT EXISTS "workspace_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"identifier" varchar(16) NOT NULL,
	"description" varchar(1000),
	"avatar" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_teams_id_workspace_unique" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workspace_teams" ADD CONSTRAINT "workspace_teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workspace_teams" ADD CONSTRAINT "workspace_teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workspace_team_members" ADD CONSTRAINT "workspace_team_members_team_workspace_fk" FOREIGN KEY ("team_id","workspace_id") REFERENCES "public"."workspace_teams"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workspace_team_members" ADD CONSTRAINT "workspace_team_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workspace_team_members" ADD CONSTRAINT "workspace_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_teams_workspace_identifier_unique" ON "workspace_teams" USING btree ("workspace_id","identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_teams_workspace_id_idx" ON "workspace_teams" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_teams_created_by_idx" ON "workspace_teams" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_team_members_team_user_unique" ON "workspace_team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_team_members_workspace_user_idx" ON "workspace_team_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_team_members_user_id_idx" ON "workspace_team_members" USING btree ("user_id");
