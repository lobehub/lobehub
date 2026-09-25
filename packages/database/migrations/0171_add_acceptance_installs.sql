CREATE TABLE IF NOT EXISTS "acceptance_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"event" varchar(16) NOT NULL,
	"version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acceptance_installs" DROP CONSTRAINT IF EXISTS "acceptance_installs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_installs" ADD CONSTRAINT "acceptance_installs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_installs" DROP CONSTRAINT IF EXISTS "acceptance_installs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "acceptance_installs" ADD CONSTRAINT "acceptance_installs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_installs_created_at_idx" ON "acceptance_installs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_installs_user_id_idx" ON "acceptance_installs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_installs_workspace_id_idx" ON "acceptance_installs" USING btree ("workspace_id");
