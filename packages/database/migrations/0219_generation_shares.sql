-- New table only: public share links for one AI generation result (/share/g/<id>).
-- No existing table is altered; every statement is idempotent.
CREATE TABLE IF NOT EXISTS "generation_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"page_view_count" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "generation_shares" DROP CONSTRAINT IF EXISTS "generation_shares_generation_id_generations_id_fk";--> statement-breakpoint
ALTER TABLE "generation_shares" ADD CONSTRAINT "generation_shares_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_shares" DROP CONSTRAINT IF EXISTS "generation_shares_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "generation_shares" ADD CONSTRAINT "generation_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_shares" DROP CONSTRAINT IF EXISTS "generation_shares_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "generation_shares" ADD CONSTRAINT "generation_shares_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "generation_shares_generation_id_unique" ON "generation_shares" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_shares_user_id_idx" ON "generation_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_shares_workspace_id_idx" ON "generation_shares" USING btree ("workspace_id");
