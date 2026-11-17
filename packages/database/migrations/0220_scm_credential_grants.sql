CREATE TABLE IF NOT EXISTS "scm_credential_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"requester_user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"device_id" text,
	"repo" varchar(255),
	"path" text NOT NULL,
	"result" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scm_credential_grants" DROP CONSTRAINT IF EXISTS "scm_credential_grants_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "scm_credential_grants" ADD CONSTRAINT "scm_credential_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_credential_grants" DROP CONSTRAINT IF EXISTS "scm_credential_grants_requester_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "scm_credential_grants" ADD CONSTRAINT "scm_credential_grants_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_credential_grants_workspace_created_idx" ON "scm_credential_grants" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_credential_grants_requester_created_idx" ON "scm_credential_grants" USING btree ("requester_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_credential_grants_operation_idx" ON "scm_credential_grants" USING btree ("operation_id");