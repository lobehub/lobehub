import { getWorkspaceRolePermissionCodes } from '@lobechat/const/rbac';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';

import type { RoleItem } from '../schemas/rbac';
import { permissions, rolePermissions, roles, userRoles } from '../schemas/rbac';
import { workspaceMembers, workspaces } from '../schemas/workspace';

export interface UserPermissionInfo {
  category: string;
  permissionCode: string;
  permissionName: string;
  roleName: string;
}

/**
 * Optional scope for a permission/role query.
 *
 * - `workspaceId: 'xxx'` — workspace mode: built-in permissions come from the
 *   member's `workspace_members.role` expanded through the in-code
 *   `WORKSPACE_ROLE_PERMISSIONS` matrix, plus globally-granted DB roles
 *   (`rbac_user_roles.workspace_id IS NULL`, e.g. `super_admin`). No
 * per-workspace authorization rows are read.
 * - `workspaceId` omitted — match **any** DB grant, regardless of workspace.
 *   This preserves backward-compat with pre-workspace-scope callers (Hono
 *   routes that just check `agent:read:all` against the whole user, with
 *   workspace isolation enforced by the resource-level query elsewhere).
 */
export interface RbacScopeOptions {
  userId?: string;
  workspaceId?: string;
}

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

  /** Resolve several users' effective workspace grants in two batched queries. */
  static getWorkspaceUsersPermissions = async ({
    db,
    requireMembership = false,
    userIds,
    workspaceId,
  }: {
    db: LobeChatDatabase;
    requireMembership?: boolean;
    userIds: string[];
    workspaceId: string;
  }): Promise<Map<string, string[]>> => {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) return new Map();

    const [memberships, globalPermissions] = await Promise.all([
      db
        .select({
          primaryOwnerId: workspaces.primaryOwnerId,
          role: workspaceMembers.role,
          userId: workspaceMembers.userId,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            inArray(workspaceMembers.userId, uniqueUserIds),
            isNull(workspaceMembers.deletedAt),
          ),
        ),
      db
        .select({ permissionCode: permissions.code, userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(
          and(
            inArray(userRoles.userId, uniqueUserIds),
            isNull(userRoles.workspaceId),
            eq(roles.isActive, true),
            eq(permissions.isActive, true),
            sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
          ),
        ),
    ]);

    const membershipByUserId = new Map(
      memberships.map((membership) => [membership.userId, membership]),
    );
    const globalPermissionsByUserId = new Map<string, string[]>();
    for (const { permissionCode, userId } of globalPermissions) {
      const codes = globalPermissionsByUserId.get(userId) ?? [];
      codes.push(permissionCode);
      globalPermissionsByUserId.set(userId, codes);
    }

    const permissionsByUserId = new Map<string, string[]>();
    for (const userId of uniqueUserIds) {
      const membership = membershipByUserId.get(userId);
      if (requireMembership && !membership) continue;

      const role =
        membership?.role === 'owner' && membership.primaryOwnerId !== userId
          ? 'admin'
          : membership?.role;
      permissionsByUserId.set(userId, [
        ...new Set([
          ...(role ? getWorkspaceRolePermissionCodes(role) : []),
          ...(globalPermissionsByUserId.get(userId) ?? []),
        ]),
      ]);
    }

    return permissionsByUserId;
  };

  /**
   * Active membership role of a user in a workspace, or null for non-members.
   * `workspace_members.role` is the single source of truth for built-in
   * workspace roles. Owner is bound to `workspaces.primaryOwnerId`: a legacy
   * non-primary `owner` label (data not yet converged) expands as Admin so it
   * can never pass Owner-only gates.
   */
  private getWorkspaceMembershipRole = async (
    userId: string,
    workspaceId: string,
  ): Promise<string | null> => {
    const [row] = await this.db
      .select({ primaryOwnerId: workspaces.primaryOwnerId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.role === 'owner' && row.primaryOwnerId !== userId) return 'admin';
    return row.role;
  };

  /**
   * Permission codes granted by globally-scoped DB roles only
   * (`rbac_user_roles.workspace_id IS NULL`, e.g. `super_admin`). Workspace
   * requests fall back to this after the in-code matrix misses so global
   * admins keep cross-workspace access.
   */
  private getGlobalPermissionCodes = async (
    userId: string,
    permissionCodes?: string[],
  ): Promise<string[]> => {
    const result = await this.db
      .select({ permissionCode: permissions.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          isNull(userRoles.workspaceId),
          permissionCodes ? inArray(permissions.code, permissionCodes) : undefined,
          eq(roles.isActive, true),
          eq(permissions.isActive, true),
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      );
    return [...new Set(result.map((row) => row.permissionCode))];
  };

  /**
   * Get all permissions for a specific user. Accepts either a plain `userId`
   * string (legacy global-scope check) or `{ userId?, workspaceId? }`
   * (workspace-aware). Permission codes returned include the `:all`/`:owner`
   * scope suffix.
   *
   * Workspace mode = in-code matrix expansion of the membership role, unioned
   * with globally-granted DB roles (super_admin). Per-workspace authorization
   * rows are not read.
   */
  getUserPermissions = async (arg?: string | RbacScopeOptions): Promise<string[]> => {
    const opts = normalizeScope(arg);
    const targetUserId = opts.userId || this.userId;

    if (opts.workspaceId) {
      const permissionsByUserId = await RbacModel.getWorkspaceUsersPermissions({
        db: this.db,
        userIds: [targetUserId],
        workspaceId: opts.workspaceId,
      });
      return permissionsByUserId.get(targetUserId) ?? [];
    }

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
          // Workspace mode restricts to globally-granted roles: built-in
          // workspace permissions live in the in-code matrix, not the DB.
          opts.workspaceId ? isNull(userRoles.workspaceId) : undefined,
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
    return this.hasAnyPermission([permissionCode], arg);
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

    if (opts.workspaceId) {
      const membershipRole = await this.getWorkspaceMembershipRole(targetUserId, opts.workspaceId);
      const matrixCodes = membershipRole
        ? new Set(getWorkspaceRolePermissionCodes(membershipRole))
        : null;
      if (matrixCodes && permissionCodes.some((code) => matrixCodes.has(code))) return true;

      // Matrix miss — a globally-granted role (super_admin) may still allow it.
      const globalMatches = await this.getGlobalPermissionCodes(targetUserId, permissionCodes);
      return globalMatches.length > 0;
    }

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
   * Get user's active DB roles. In workspace mode only globally-granted roles
   * are returned — built-in workspace roles live on `workspace_members.role`,
   * not in the RBAC tables.
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
          opts.workspaceId ? isNull(userRoles.workspaceId) : undefined,
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      )
      .orderBy(userRoles.createdAt);
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
