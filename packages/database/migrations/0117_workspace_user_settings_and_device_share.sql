CREATE TABLE IF NOT EXISTS "workspace_user_settings" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"preference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_user_settings_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "shared_from_device_id" varchar(64);--> statement-breakpoint
ALTER TABLE "workspace_user_settings" DROP CONSTRAINT IF EXISTS "workspace_user_settings_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "workspace_user_settings" ADD CONSTRAINT "workspace_user_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_user_settings" DROP CONSTRAINT IF EXISTS "workspace_user_settings_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "workspace_user_settings" ADD CONSTRAINT "workspace_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_user_settings_user_id_idx" ON "workspace_user_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_workspace_visibility_idx" ON "devices" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
-- Rows that predate the column were enrolled when every workspace device was
-- visible to all members; keep that behaviour for them. The 'private' column
-- default applies only to enrollments created after this migration.
UPDATE "devices" SET "visibility" = 'public' WHERE "workspace_id" IS NOT NULL AND "visibility" = 'private';
