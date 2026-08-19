-- Operator identity (control-plane admin) separate from chat Better Auth users.
CREATE TABLE IF NOT EXISTS "platform_admin_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admin_users_email_uidx" ON "platform_admin_users" USING btree ("email");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admin_sessions_token_hash_uidx" ON "platform_admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_admin_sessions_admin_user_id_idx" ON "platform_admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_admin_sessions_expires_at_idx" ON "platform_admin_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "platform_admin_sessions" DROP CONSTRAINT IF EXISTS "platform_admin_sessions_admin_user_id_platform_admin_users_id_fk";--> statement-breakpoint
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_admin_user_id_platform_admin_users_id_fk"
	FOREIGN KEY ("admin_user_id") REFERENCES "public"."platform_admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "created_by_admin_id" text;--> statement-breakpoint
ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_transactions_created_by_admin_id_platform_admin_users_id_fk";--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_created_by_admin_id_platform_admin_users_id_fk"
	FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."platform_admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aico_security_audit_logs" ADD COLUMN IF NOT EXISTS "actor_admin_id" text;--> statement-breakpoint
ALTER TABLE "aico_security_audit_logs" DROP CONSTRAINT IF EXISTS "aico_security_audit_logs_actor_admin_id_platform_admin_users_id_fk";--> statement-breakpoint
ALTER TABLE "aico_security_audit_logs" ADD CONSTRAINT "aico_security_audit_logs_actor_admin_id_platform_admin_users_id_fk"
	FOREIGN KEY ("actor_admin_id") REFERENCES "public"."platform_admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aico_security_audit_logs_actor_admin_id_idx" ON "aico_security_audit_logs" USING btree ("actor_admin_id");--> statement-breakpoint
-- Copy existing grant emails into operator accounts. Password is unusable until
-- AICO_BOOTSTRAP_ADMIN_EMAIL / AICO_BOOTSTRAP_ADMIN_PASSWORD (or addPlatformAdmin) sets it.
INSERT INTO "platform_admin_users" ("id", "email", "name", "password_hash")
SELECT
	'opusr_' || substr(md5(pa.id || coalesce(u.email, pa.user_id)), 1, 12),
	lower(u.email),
	NULL,
	'unusable:' || pa.id
FROM "platform_admins" pa
INNER JOIN "users" u ON u.id = pa.user_id
WHERE u.email IS NOT NULL AND length(trim(u.email)) > 0
ON CONFLICT ("email") DO NOTHING;
