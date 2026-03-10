import { sql } from 'drizzle-orm';

import { RBAC_PERMISSIONS } from '@/const/rbac';

import { permissions, rolePermissions, roles, userRoles, users } from './schemas';
import type { LobeChatDatabase, Transaction } from './type';

const DEFAULT_ROLE = {
  description: 'Default role for all system users',
  displayName: 'Default User',
  name: 'default',
} as const;

export interface RBACInitializationResult {
  assignedUserRoleCount: number;
  defaultRoleId: string;
  grantedPermissionCount: number;
  ownerPermissionCount: number;
  seededPermissionCount: number;
}

interface PermissionSeed {
  category: string;
  code: string;
  description: string;
  name: string;
}

type DBExecutor = LobeChatDatabase | Transaction;

const formatTitle = (value: string) =>
  value
    .split(/[_:]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const buildPermissionSeeds = (): PermissionSeed[] =>
  Object.values(RBAC_PERMISSIONS).map((code) => {
    const parts = code.split(':');
    const category = parts[0]!;
    const scope = parts.at(-1)!;
    const action = parts.slice(1, -1).join(':');

    return {
      category,
      code,
      description: `Allows ${formatTitle(action)} on ${formatTitle(category)} within ${scope} scope.`,
      name: `${formatTitle(category)} ${formatTitle(action)} ${formatTitle(scope)}`,
    };
  });

const ensureDefaultRole = async (db: DBExecutor, now: Date): Promise<string> => {
  const [role] = await db
    .insert(roles)
    .values({
      description: DEFAULT_ROLE.description,
      displayName: DEFAULT_ROLE.displayName,
      isActive: true,
      isSystem: true,
      name: DEFAULT_ROLE.name,
    })
    .onConflictDoUpdate({
      set: {
        description: DEFAULT_ROLE.description,
        displayName: DEFAULT_ROLE.displayName,
        isActive: true,
        isSystem: true,
        updatedAt: now,
      },
      target: roles.name,
    })
    .returning({ id: roles.id });

  if (!role) throw new Error('Failed to upsert default RBAC role');

  return role.id;
};

const syncPermissions = async (db: DBExecutor, now: Date) => {
  const permissionSeeds = buildPermissionSeeds();

  return db
    .insert(permissions)
    .values(permissionSeeds)
    .onConflictDoUpdate({
      set: {
        category: sql`excluded.category`,
        description: sql`excluded.description`,
        isActive: true,
        name: sql`excluded.name`,
        updatedAt: now,
      },
      target: permissions.code,
    })
    .returning({ code: permissions.code, id: permissions.id });
};

const grantOwnerPermissionsToDefaultRole = async (
  db: DBExecutor,
  roleId: string,
  syncedPermissions: Array<{ code: string; id: string }>,
) => {
  const ownerPermissions = syncedPermissions.filter((p) => p.code.endsWith(':owner'));

  if (ownerPermissions.length === 0) {
    return { grantedPermissionCount: 0, ownerPermissionCount: 0 };
  }

  const granted = await db
    .insert(rolePermissions)
    .values(ownerPermissions.map((p) => ({ permissionId: p.id, roleId })))
    .onConflictDoNothing()
    .returning({ permissionId: rolePermissions.permissionId });

  return {
    grantedPermissionCount: granted.length,
    ownerPermissionCount: ownerPermissions.length,
  };
};

const assignDefaultRoleToExistingUsers = async (db: DBExecutor, roleId: string) => {
  const allUsers = await db.select({ id: users.id }).from(users);

  if (allUsers.length === 0) return 0;

  const assigned = await db
    .insert(userRoles)
    .values(allUsers.map((u) => ({ roleId, userId: u.id })))
    .onConflictDoNothing()
    .returning({ userId: userRoles.userId });

  return assigned.length;
};

/**
 * Seed the default RBAC role, sync all permissions, grant OWNER-scoped permissions
 * to the default role, and back-fill existing users.
 *
 * This function is designed to be idempotent — safe to call on every deployment.
 * The DB-level trigger (migration 0091) handles new-user assignment going forward;
 * this function handles the initial data seed and back-fill that the trigger cannot cover.
 */
export const initializeRBAC = async (db: LobeChatDatabase): Promise<RBACInitializationResult> => {
  console.info('[database] Initializing RBAC data...');

  try {
    const result = await db.transaction(async (tx) => {
      const now = new Date();
      const defaultRoleId = await ensureDefaultRole(tx, now);
      const syncedPermissions = await syncPermissions(tx, now);
      const { grantedPermissionCount, ownerPermissionCount } =
        await grantOwnerPermissionsToDefaultRole(tx, defaultRoleId, syncedPermissions);
      const assignedUserRoleCount = await assignDefaultRoleToExistingUsers(tx, defaultRoleId);

      return {
        assignedUserRoleCount,
        defaultRoleId,
        grantedPermissionCount,
        ownerPermissionCount,
        seededPermissionCount: syncedPermissions.length,
      };
    });

    console.info(
      '[database] RBAC initialization completed. role=%s permissions=%d ownerPermissions=%d newGrants=%d newUserRoles=%d',
      result.defaultRoleId,
      result.seededPermissionCount,
      result.ownerPermissionCount,
      result.grantedPermissionCount,
      result.assignedUserRoleCount,
    );

    return result;
  } catch (error) {
    console.error('[database] Failed to initialize RBAC data:', error);
    throw error;
  }
};
