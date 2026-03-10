-- Seed the default RBAC role (idempotent via ON CONFLICT).
-- The hardcoded id is only used for the initial insert; subsequent deployments
-- rely on initializeRBAC() which upserts by name and preserves the existing id.
INSERT INTO "rbac_roles" ("id", "name", "display_name", "description", "is_system", "is_active")
VALUES ('4f90d13a42bc7de8', 'default', 'Default User', 'Default role for all system users', true, true)
ON CONFLICT ("name") DO UPDATE
SET
  "display_name" = EXCLUDED."display_name",
  "description" = EXCLUDED."description",
  "is_system" = true,
  "is_active" = true,
  "updated_at" = now();
--> statement-breakpoint

-- Back-fill: assign the default role to every existing user.
-- initializeRBAC() performs the same back-fill at the application layer;
-- keeping it here ensures correctness even if initializeRBAC() is skipped.
INSERT INTO "rbac_user_roles" ("user_id", "role_id")
SELECT "users"."id", "rbac_roles"."id"
FROM "users"
INNER JOIN "rbac_roles" ON "rbac_roles"."name" = 'default'
ON CONFLICT ("user_id", "role_id") DO NOTHING;
--> statement-breakpoint

-- Trigger: auto-assign the default role to every newly created user.
CREATE OR REPLACE FUNCTION "assign_default_rbac_role_to_new_user"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "rbac_user_roles" ("user_id", "role_id")
  SELECT NEW."id", "rbac_roles"."id"
  FROM "rbac_roles"
  WHERE "rbac_roles"."name" = 'default'
  ON CONFLICT ("user_id", "role_id") DO NOTHING;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "users_assign_default_rbac_role" ON "users";
--> statement-breakpoint

CREATE TRIGGER "users_assign_default_rbac_role"
AFTER INSERT ON "users"
FOR EACH ROW
EXECUTE FUNCTION "assign_default_rbac_role_to_new_user"();
