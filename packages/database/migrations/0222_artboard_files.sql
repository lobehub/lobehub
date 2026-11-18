CREATE TABLE IF NOT EXISTS "artboard_files" (
	"artboard_id" text NOT NULL,
	"path" text NOT NULL,
	"hash" text NOT NULL,
	"size" integer NOT NULL,
	"content_type" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artboard_files_artboard_id_path_pk" PRIMARY KEY("artboard_id","path")
);
--> statement-breakpoint
ALTER TABLE "artboard_files" DROP CONSTRAINT IF EXISTS "artboard_files_artboard_id_artboards_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_files" ADD CONSTRAINT "artboard_files_artboard_id_artboards_id_fk" FOREIGN KEY ("artboard_id") REFERENCES "public"."artboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_files" DROP CONSTRAINT IF EXISTS "artboard_files_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_files" ADD CONSTRAINT "artboard_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artboard_files" DROP CONSTRAINT IF EXISTS "artboard_files_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "artboard_files" ADD CONSTRAINT "artboard_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_files_user_id_idx" ON "artboard_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artboard_files_workspace_id_idx" ON "artboard_files" USING btree ("workspace_id") WHERE "artboard_files"."workspace_id" IS NOT NULL;