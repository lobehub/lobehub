-- SQL migration: add audit_logs table
-- Path: scripts/migrations/20260704_add_audit_logs.sql

BEGIN;

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NULL,
  subject_user_id uuid NULL,
  workspace_id uuid NULL,
  details jsonb NULL,
  created_at timestamptz DEFAULT now()
);

COMMIT;
