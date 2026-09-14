CREATE TABLE IF NOT EXISTS "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"pathname" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"multipart_upload_id" text,
	"multipart_part_size" integer,
	"completed_at" timestamp with time zone,
	"file_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT IF EXISTS "file_uploads_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT IF EXISTS "file_uploads_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" DROP CONSTRAINT IF EXISTS "file_uploads_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_uploads_user_scope_status_idx" ON "file_uploads" USING btree ("user_id","workspace_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_uploads_workspace_status_idx" ON "file_uploads" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_uploads_status_expires_at_idx" ON "file_uploads" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_uploads_status_updated_at_id_idx" ON "file_uploads" USING btree ("status","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_uploads_live_pathname_unique" ON "file_uploads" USING btree ("pathname") WHERE "file_uploads"."status" IN ('active', 'cleaning');
