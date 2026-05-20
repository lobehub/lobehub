-- Admin: Feature Flags
CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL,
  "label" text NOT NULL,
  "default_enabled" boolean NOT NULL DEFAULT false,
  "enabled_user_ids" jsonb DEFAULT '[]',
  "disabled_user_ids" jsonb DEFAULT '[]',
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_unique" ON "feature_flags" ("key");
CREATE INDEX IF NOT EXISTS "feature_flags_key_idx" ON "feature_flags" ("key");

-- Admin: Audit Logs
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_id" text NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
  "admin_email" text,
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "metadata" jsonb,
  "ip_address" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "audit_logs_admin_id_idx" ON "admin_audit_logs" ("admin_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "admin_audit_logs" ("action");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "admin_audit_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_target_id_idx" ON "admin_audit_logs" ("target_id");

-- Admin: API Keys
CREATE TABLE IF NOT EXISTS "admin_api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service" text NOT NULL UNIQUE,
  "key_value" text NOT NULL,
  "label" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "config" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "admin_api_keys_service_idx" ON "admin_api_keys" ("service");
