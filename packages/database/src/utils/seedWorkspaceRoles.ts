import {
  PERMISSION_ACTIONS,
  WORKSPACE_ROLE_DESCRIPTIONS,
  WORKSPACE_ROLE_DISPLAY_NAMES,
  WORKSPACE_ROLE_PERMISSIONS,
  WORKSPACE_SYSTEM_ROLES,
  type WorkspaceSystemRoleName,
} from '@lobechat/const/rbac';
import { and, eq, inArray } from 'drizzle-orm';

import { permissions, rolePermissions, roles, userRoles } from '../schemas/rbac';
import type { LobeChatDatabase, Transaction } from '../type';

type WorkspaceRoleMutationDb = LobeChatDatabase | Transaction;

/**
 * Map a permission code (e.g. `agent:create`) to the category column —
 * always the substring before the first colon. Keeps the seeded
 * `rbac_permissions.category` consistent with the legacy Hono seed data
 * style and makes filtering by category trivial.
 */
const codeToCategory = (code: string): string => code.split(':')[0];

/**
 * Strip the `:all` / `:owner` suffix from a scoped permission code and look
 * up the action's display name from `PERMISSION_ACTIONS`. Returns a sensible
 * fallback when the code isn't recognised so seeding never throws on an
 * unknown permission.
 */
const codeToName = (code: string): string => {
  const base = code.replace(/:(all|owner)$/, '');
  const entry = Object.entries(PERMISSION_ACTIONS).find(([, value]) => value === base);
  if (!entry) return code;
  return entry[0]
    .toLowerCase()
    .split('_')
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join(' ');
};

/**
 * Ensure every permission code referenced by the three built-in workspace
 * roles exists in `rbac_permissions`. Idempotent — re-runs are safe because
 * we only insert codes that are missing.
 *
 * Returns a map from `code` to permission `id` for use by the role-permission
 * linkage step. Permissions live in the global table (no workspaceId) — only
 * the *roles* are workspace-scoped.
 */
const ensurePermissionsExist = async (db: LobeChatDatabase): Promise<Map<string, string>> => {
  const requiredCodes = new Set<string>();
  for (const codes of Object.values(WORKSPACE_ROLE_PERMISSIONS)) {
    for (const code of codes) requiredCodes.add(code);
  }
  const codeList = [...requiredCodes];

  const existing = await db
    .select({ code: permissions.code, id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, codeList));

  const existingCodes = new Set(existing.map((p) => p.code));
  const missing = codeList.filter((code) => !existingCodes.has(code));

  if (missing.length > 0) {
    await db
      .insert(permissions)
      .values(
        missing.map((code) => ({
          category: codeToCategory(code),
          code,
          isActive: true,
          name: codeToName(code),
        })),
      )
      .onConflictDoNothing({ target: permissions.code });
  }

  const all = await db
    .select({ code: permissions.code, id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, codeList));

  return new Map(all.map((p) => [p.code, p.id] as const));
};

/**
 * Create the workspace's copy of one built-in role (e.g. `workspace_owner`)
 * if it doesn't already exist, then ensure the role-permission links match
 * the spec in `WORKSPACE_ROLE_PERMISSIONS`. Returns the role id.
 *
 * The role is uniquely identified by `(name, workspaceId)` via the
 * `rbac_roles_name_scope_unique` index — `onConflictDoNothing` makes the
 * insert idempotent.
 */
const upsertWorkspaceRole = async (
  db: LobeChatDatabase,
  workspaceId: string,
  roleName: WorkspaceSystemRoleName,
  permissionIdByCode: Map<string, string>,
): Promise<string> => {
  const existing = await db.query.roles.findFirst({
    where: and(eq(roles.name, roleName), eq(roles.workspaceId, workspaceId)),
  });

  let roleId: string;
  if (existing) {
    roleId = existing.id;
  } else {
    const [inserted] = await db
      .insert(roles)
      .values({
        description: WORKSPACE_ROLE_DESCRIPTIONS[roleName],
        displayName: WORKSPACE_ROLE_DISPLAY_NAMES[roleName],
        isActive: true,
        isSystem: true,
        name: roleName,
        workspaceId,
      })
      .returning({ id: roles.id });
    roleId = inserted.id;
  }

  const targetCodes = WORKSPACE_ROLE_PERMISSIONS[roleName];
  const targetIds = targetCodes
    .map((code) => permissionIdByCode.get(code))
    .filter((id): id is string => !!id);

  if (targetIds.length === 0) return roleId;

  // Insert missing links; ON CONFLICT DO NOTHING handles re-seed.
  await db
    .insert(rolePermissions)
    .values(targetIds.map((permissionId) => ({ permissionId, roleId })))
    .onConflictDoNothing();

  return roleId;
};

export interface SeededWorkspaceRoles {
  memberRoleId: string;
  ownerRoleId: string;
  viewerRoleId: string;
}

/**
 * Idempotently provision the three built-in workspace roles plus all
 * permissions they depend on.
 *
 * Safe to call:
 * - On `workspace.create` (new workspace gets its role triplet)
 * - From a bootstrap script over every existing workspace (backfill)
 * - Re-run on the same workspace (no-op after the first run)
 */
export const seedWorkspaceRoles = async (
  db: LobeChatDatabase,
  workspaceId: string,
): Promise<SeededWorkspaceRoles> => {
  const permissionIdByCode = await ensurePermissionsExist(db);
  const ownerRoleId = await upsertWorkspaceRole(
    db,
    workspaceId,
    WORKSPACE_SYSTEM_ROLES.OWNER,
    permissionIdByCode,
  );
  const memberRoleId = await upsertWorkspaceRole(
    db,
    workspaceId,
    WORKSPACE_SYSTEM_ROLES.MEMBER,
    permissionIdByCode,
  );
  const viewerRoleId = await upsertWorkspaceRole(
    db,
    workspaceId,
    WORKSPACE_SYSTEM_ROLES.VIEWER,
    permissionIdByCode,
  );

  return { memberRoleId, ownerRoleId, viewerRoleId };
};

/**
 * Grant `userId` the named built-in workspace role. Idempotent — re-grants
 * are no-ops thanks to the `(user_id, role_id, workspace_id)` unique index.
 *
 * Used by:
 * - `workspace.create` — assign creator to `workspace_owner`
 * - `workspaceMember.invite` accept flow — assign the invited role
 * - Backfill — translate every existing `workspace_members.role` row into a
 *   matching `rbac_user_roles` row
 */
export const assignWorkspaceRoleToUser = async (
  db: WorkspaceRoleMutationDb,
  params: {
    roleName: WorkspaceSystemRoleName;
    userId: string;
    workspaceId: string;
  },
): Promise<void> => {
  const role = await db.query.roles.findFirst({
    where: and(eq(roles.name, params.roleName), eq(roles.workspaceId, params.workspaceId)),
  });

  if (!role) {
    throw new Error(
      `Workspace role ${params.roleName} not found for workspace ${params.workspaceId}. ` +
        `Call seedWorkspaceRoles first.`,
    );
  }

  await db
    .insert(userRoles)
    .values({ roleId: role.id, userId: params.userId, workspaceId: params.workspaceId })
    .onConflictDoNothing();
};

/**
 * Revoke every workspace-scoped role for `(userId, workspaceId)`. Used by
 * `workspaceMember.remove / leave` and when changing a user's role (followed
 * by a fresh `assignWorkspaceRoleToUser` call).
 */
export const revokeWorkspaceRolesForUser = async (
  db: WorkspaceRoleMutationDb,
  params: { userId: string; workspaceId: string },
): Promise<void> => {
  await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, params.userId), eq(userRoles.workspaceId, params.workspaceId)));
};
