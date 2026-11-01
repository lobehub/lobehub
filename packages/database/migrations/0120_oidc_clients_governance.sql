ALTER TABLE "oidc_clients" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD COLUMN IF NOT EXISTS "enabled" boolean;--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oidc_clients" DROP CONSTRAINT IF EXISTS "oidc_clients_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD CONSTRAINT "oidc_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_clients" DROP CONSTRAINT IF EXISTS "oidc_clients_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD CONSTRAINT "oidc_clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_clients_user_id_idx" ON "oidc_clients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_clients_workspace_id_idx" ON "oidc_clients" USING btree ("workspace_id");
