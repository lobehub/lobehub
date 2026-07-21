CREATE TABLE IF NOT EXISTS "resource_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"access_level" text NOT NULL,
	"created_by" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD COLUMN IF NOT EXISTS "application_id" varchar(255);--> statement-breakpoint
ALTER TABLE "messenger_account_links" ADD COLUMN IF NOT EXISTS "credentials" text;--> statement-breakpoint
ALTER TABLE "resource_permissions" DROP CONSTRAINT IF EXISTS "resource_permissions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "resource_permissions" ADD CONSTRAINT "resource_permissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_permissions" DROP CONSTRAINT IF EXISTS "resource_permissions_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "resource_permissions" ADD CONSTRAINT "resource_permissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_permissions_workspace_resource_unique" ON "resource_permissions" USING btree ("workspace_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_permissions_resource_idx" ON "resource_permissions" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_permissions_workspace_idx" ON "resource_permissions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messenger_account_links_platform_tenant_application_unique" ON "messenger_account_links" USING btree ("platform","tenant_id","application_id") WHERE "messenger_account_links"."application_id" is not null;
