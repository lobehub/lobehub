CREATE TABLE IF NOT EXISTS "skill_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"identifier" text NOT NULL,
	"event" varchar(16) NOT NULL,
	"version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_installs" DROP CONSTRAINT IF EXISTS "skill_installs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "skill_installs" ADD CONSTRAINT "skill_installs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_installs" DROP CONSTRAINT IF EXISTS "skill_installs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "skill_installs" ADD CONSTRAINT "skill_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_installs_identifier_created_at_idx" ON "skill_installs" USING btree ("identifier","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_installs_user_id_idx" ON "skill_installs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_installs_workspace_id_idx" ON "skill_installs" USING btree ("workspace_id");
