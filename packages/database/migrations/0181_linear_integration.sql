CREATE TABLE IF NOT EXISTS "linear_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"organization_id" varchar(255) NOT NULL,
	"organization_name" varchar(255) NOT NULL,
	"organization_url_key" varchar(255) NOT NULL,
	"actor_external_id" varchar(255) NOT NULL,
	"actor_name" varchar(255) NOT NULL,
	"credentials" text,
	"token_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linear_connections" DROP CONSTRAINT IF EXISTS "linear_connections_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "linear_connections" ADD CONSTRAINT "linear_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_connections" DROP CONSTRAINT IF EXISTS "linear_connections_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "linear_connections" ADD CONSTRAINT "linear_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "linear_connections_org_personal_unique" ON "linear_connections" USING btree ("organization_id","user_id") WHERE "linear_connections"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "linear_connections_org_workspace_unique" ON "linear_connections" USING btree ("organization_id","user_id","workspace_id") WHERE "linear_connections"."workspace_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_connections_user_id_idx" ON "linear_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_connections_workspace_id_idx" ON "linear_connections" USING btree ("workspace_id");