CREATE TABLE IF NOT EXISTS "user_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"type" text NOT NULL,
	"target_id" text NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_favorites" DROP CONSTRAINT IF EXISTS "user_favorites_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorites" DROP CONSTRAINT IF EXISTS "user_favorites_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_favorites_personal_target_unique" ON "user_favorites" USING btree ("user_id","type","target_id") WHERE "user_favorites"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_favorites_workspace_target_unique" ON "user_favorites" USING btree ("user_id","workspace_id","type","target_id") WHERE "user_favorites"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_favorites_user_id_idx" ON "user_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_favorites_workspace_id_idx" ON "user_favorites" USING btree ("workspace_id");