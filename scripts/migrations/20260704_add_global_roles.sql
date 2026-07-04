-- SQL migration: add global roles, role_permissions, user_roles
-- Path: scripts/migrations/20260704_add_global_roles.sql

BEGIN;

-- Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('global','workspace','system')),
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create user_roles table
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  workspace_id uuid NULL,
  assigned_by uuid NULL,
  assigned_at timestamptz DEFAULT now(),
  expires_at timestamptz NULL
);

-- Seed default global roles: free, vip
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'free' AND scope = 'global') THEN
    INSERT INTO roles (name, scope, description) VALUES ('free', 'global', 'Default free user role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'vip' AND scope = 'global') THEN
    INSERT INTO roles (name, scope, description) VALUES ('vip', 'global', 'VIP user role with extra permissions');
  END IF;
END$$;

-- Map minimal permissions for seeded roles (this is a PoC mapping)
-- free: can read agents and invoke message create but cannot create agents/skills
-- vip: can create/update agents/skills

-- free permissions (example)
DO $$
DECLARE free_role_id uuid;
BEGIN
  SELECT id INTO free_role_id FROM roles WHERE name='free' AND scope='global' LIMIT 1;
  IF free_role_id IS NOT NULL THEN
    -- insert only if missing
    INSERT INTO role_permissions (role_id, permission)
    SELECT free_role_id, p
    FROM (VALUES
      ('agent:read:all'),
      ('session:create:owner'),
      ('message:create:owner')
    ) AS v(p)
    WHERE NOT EXISTS (
      SELECT 1 FROM role_permissions WHERE role_id = free_role_id AND permission = v.p
    );
  END IF;
END$$;

-- vip permissions (example)
DO $$
DECLARE vip_role_id uuid;
BEGIN
  SELECT id INTO vip_role_id FROM roles WHERE name='vip' AND scope='global' LIMIT 1;
  IF vip_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission)
    SELECT vip_role_id, p
    FROM (VALUES
      ('agent:read:all'),
      ('agent:create:all'),
      ('agent:update:all'),
      ('agent:delete:all'),
      ('skill:create:all'),
      ('skill:update:all')
    ) AS v(p)
    WHERE NOT EXISTS (
      SELECT 1 FROM role_permissions WHERE role_id = vip_role_id AND permission = v.p
    );
  END IF;
END$$;

COMMIT;
