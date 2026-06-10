import type { WorkspaceSystemRoleName } from '@lobechat/const/rbac';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';

import type { RoleItem } from '../schemas/rbac';
import { permissions, rolePermissions, roles, userRoles } from '../schemas/rbac';
import {
  assignWorkspaceRoleToUser,
  revokeWorkspaceRolesForUser,
} from '../utils/seedWorkspaceRoles';

export interface UserPermissionInfo {
  category: string;
  permissionCode: string;
  permissionName: string;
  roleName: string;
}

/**
 * Optional scope for a permission/role query.
 *
 * - `workspaceId: 'xxx'` — match grants in that workspace plus globally-granted
 *   roles (`rbac_user_roles.workspace_id IS NULL`, e.g. `super_admin`). This is
 *   what tRPC `withRbacPermission` uses inside a workspace request.
 * - `workspaceId` omitted — match **any** grant, regardless of workspace. This
 *   preserves backward-compat with pre-workspace-scope callers (Hono routes
 *   that just check `agent:read:all` against the whole user, with workspace
 *   isolation enforced by the resource-level query elsewhere).
 *
 * Callers that want to assert "only globally-granted roles count" must do that
 * filter themselves on the result set; we don't expose a third mode here
 * because no production caller needs it today.
 */
export interface RbacScopeOptions {
  userId?: string;
  workspaceId?: string;
}

/**
 * Build the `WHERE rbac_user_roles.workspace_id ...` predicate used by every
 * permission/role lookup. Encodes the rule above in one place so the four
 * query methods don't drift. Returns `undefined` when no workspace scope
 * filter should be applied (legacy behavior).
 */
const buildScopeWhere = (workspaceId: string | undefined) =>
  workspaceId
    ? or(eq(userRoles.workspaceId, workspaceId), isNull(userRoles.workspaceId))
    : undefined;

/**
 * Back-compat shim: existing call sites pass a bare `userId` string as the
 * second arg. New call sites pass `{ userId?, workspaceId? }`. Normalise both
 * forms into the option object.
 */
const normalizeScope = (arg: string | RbacScopeOptions | undefined): RbacScopeOptions => {
  if (!arg) return {};
  if (typeof arg === 'string') return { userId: arg };
  return arg;
};

export class RbacModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Get all permissions for a specific user. Accepts either a plain `userId`
   * string (legacy global-scope check) or `{ userId?, workspaceId? }`
   * (workspace-aware). Permission codes returned include the `:all`/`:owner`
   * scope suffix as stored in `rbac_permissions.code`.
   */
  getUserPermissions = async (arg?: string | RbacScopeOptions): Promise<string[]> => {
    const opts = normalizeScope(arg);
    const targetUserId = opts.userId || this.userId;

    const result = await this.db
      .select({
        permissionCode: permissions.code,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          eq(roles.isActive, true),
          eq(permissions.isActive, true),
          buildScopeWhere(opts.workspaceId),
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      );

    // De-dupe — the same code can come from multiple roles (e.g. owner +
    // member if a user somehow ends up with both).
    return [...new Set(result.map((row) => row.permissionCode))];
  };

  /**
   * Get detailed permission information for a user. Same scope rules as
   * `getUserPermissions`.
   */
  getUserPermissionDetails = async (
    arg?: string | RbacScopeOptions,
  ): Promise<UserPermissionInfo[]> => {
    const opts = normalizeScope(arg);
    const targetUserId = opts.userId || this.userId;

    return await this.db
      .select({
        category: permissions.category,
        permissionCode: permissions.code,
        permissionName: permissions.name,
        roleName: roles.name,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          eq(roles.isActive, true),
          eq(permissions.isActive, true),
          buildScopeWhere(opts.workspaceId),
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      )
      .orderBy(permissions.category, permissions.code);
  };

  /**
   * Check if user has a specific permission. Pass `{ workspaceId }` to scope
   * the check to a workspace (global grants still apply).
   */
  hasPermission = async (
    permissionCode: string,
    arg?: string | RbacScopeOptions,
  ): Promise<boolean> => {
    const opts = normalizeScope(arg);
    const targetUserId = opts.userId || this.userId;

    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          inArray(permissions.code, [permissionCode]),
          eq(roles.isActive, true),
          eq(permissions.isActive, true),
          buildScopeWhere(opts.workspaceId),
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      );

    return (result[0]?.count || 0) > 0;
  };

  /**
   * Check if user has any of the specified permissions (OR logic).
   */
  hasAnyPermission = async (
    permissionCodes: string[],
    arg?: string | RbacScopeOptions,
  ): Promise<boolean> => {
    if (permissionCodes.length === 0) return false;

    const opts = normalizeScope(arg);
    const targetUserId = opts.userId || this.userId;

    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          inArray(permissions.code, permissionCodes),
          eq(roles.isActive, true),
          eq(permissions.isActive, true),
          buildScopeWhere(opts.workspaceId),
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      );

    return (result[0]?.count || 0) > 0;
  };

  /**
   * Check if user has all of the specified permissions (AND logic).
   */
  hasAllPermissions = async (
    permissionCodes: string[],
    arg?: string | RbacScopeOptions,
  ): Promise<boolean> => {
    if (permissionCodes.length === 0) return true;

    const checks = await Promise.all(permissionCodes.map((code) => this.hasPermission(code, arg)));
    return checks.every(Boolean);
  };

  /**
   * Get user's active roles. Same scope rules as `hasPermission`.
   */
  getUserRoles = async (arg?: string | RbacScopeOptions): Promise<RoleItem[]> => {
    const opts = normalizeScope(arg);
    const targetUserId = opts.userId || this.userId;

    return await this.db
      .select({
        accessedAt: roles.accessedAt,
        createdAt: roles.createdAt,
        description: roles.description,
        displayName: roles.displayName,
        id: roles.id,
        isActive: roles.isActive,
        isSystem: roles.isSystem,
        metadata: roles.metadata,
        name: roles.name,
        updatedAt: roles.updatedAt,
        workspaceId: roles.workspaceId,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          eq(roles.isActive, true),
          buildScopeWhere(opts.workspaceId),
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      )
      .orderBy(userRoles.createdAt);
  };

  /**
   * List all roles defined inside a workspace (both built-in and custom).
   * Used by the upcoming custom-role admin UI (LOBE-9193) and any client that
   * wants to show available roles for a workspace.
   */
  listWorkspaceRoles = async (workspaceId: string): Promise<RoleItem[]> => {
    return this.db.query.roles.findMany({
      orderBy: (table, { asc }) => [asc(table.isSystem), asc(table.name)],
      where: and(eq(roles.workspaceId, workspaceId), eq(roles.isActive, true)),
    });
  };

  /**
   * Grant a built-in workspace role (`workspace_owner` | `workspace_member` |
   * `workspace_viewer`) to a user inside a workspace. Delegates to the seed
   * util so the onConflict + role-lookup logic lives in one place.
   */
  assignWorkspaceRole = async (params: {
    roleName: WorkspaceSystemRoleName;
    userId: string;
    workspaceId: string;
  }): Promise<void> => {
    await assignWorkspaceRoleToUser(this.db, params);
  };

  /**
   * Revoke every workspace-scoped role this user holds in `workspaceId`.
   * Idempotent. Used by member removal/leave flows and by `updateRole` before
   * granting the new role.
   */
  revokeWorkspaceRole = async (params: { userId: string; workspaceId: string }): Promise<void> => {
    await revokeWorkspaceRolesForUser(this.db, params);
  };

  /**
   * Update user roles using a transaction to ensure atomicity
   * @param userId User ID
   * @param roleIds Array of role IDs
   */
  updateUserRoles = async (userId: string, roleIds: string[]): Promise<void> => {
    // Validate that the roles exist
    const existingRoles = await this.db.query.roles.findMany({
      where: inArray(roles.id, roleIds),
    });
    if (existingRoles.length !== roleIds.length) {
      const missingRoleIds = roleIds.filter((id) => !existingRoles.some((r) => r.id === id));

      throw new Error(`Roles ${missingRoleIds.join(', ')} do not exist`);
    }

    return await this.db.transaction(async (tx) => {
      // 1. Delete all existing roles for the user
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));

      // 2. Insert new roles if any are provided
      if (roleIds.length > 0) {
        await tx.insert(userRoles).values(
          roleIds.map((roleId) => ({
            roleId,
            userId,
          })),
        );
      }
    });
  };
}
