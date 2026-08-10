CREATE TABLE IF NOT EXISTS "aico_security_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"organization_id" text,
	"result" text DEFAULT 'success' NOT NULL,
	"source" text DEFAULT 'trpc' NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "aico_security_alert_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_alerted_at" timestamptz,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "aico_security_audit_logs" DROP CONSTRAINT IF EXISTS "aico_security_audit_logs_actor_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "aico_security_audit_logs" ADD CONSTRAINT "aico_security_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aico_security_audit_logs" DROP CONSTRAINT IF EXISTS "aico_security_audit_logs_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "aico_security_audit_logs" ADD CONSTRAINT "aico_security_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_security_audit_logs_action_idx" ON "aico_security_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_security_audit_logs_organization_id_idx" ON "aico_security_audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_security_audit_logs_actor_user_id_idx" ON "aico_security_audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_security_audit_logs_created_at_idx" ON "aico_security_audit_logs" USING btree ("created_at");
