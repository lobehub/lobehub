import { and, eq, inArray, sql } from 'drizzle-orm';

import { LobeChatDatabase } from '@/database/type';

import { RoleItem, permissions, rolePermissions, roles, userRoles } from '../schemas/rbac';

export interface UserPermissionInfo {
  category: string;
  permissionCode: string;
  permissionName: string;
  roleName: string;
}

export class RbacModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Get all permissions for a specific user
   * @param userId - User ID to query permissions for
   * @returns Array of permission codes that the user has
   */
  getUserPermissions = async (userId?: string): Promise<string[]> => {
    const targetUserId = userId || this.userId;

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

    return result.map((row) => row.permissionCode);
  };

  /**
   * Get detailed permission information for a user
   * @param userId - User ID to query permissions for
   * @returns Array of detailed permission information
   */
  getUserPermissionDetails = async (userId?: string): Promise<UserPermissionInfo[]> => {
    const targetUserId = userId || this.userId;

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
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      )
      .orderBy(permissions.category, permissions.code);
  };

  /**
   * Check if user has a specific permission
   * @param permissionCode - Permission code to check
   * @param userId - User ID to check (optional, defaults to instance userId)
   * @returns Boolean indicating if user has the permission
   */
  hasPermission = async (permissionCode: string, userId?: string): Promise<boolean> => {
    const targetUserId = userId || this.userId;

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
          // Check if role assignment is not expired
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > NOW())`,
        ),
      );

    return (result[0]?.count || 0) > 0;
  };

  /**
   * Check if user has any of the specified permissions (OR logic)
   * @param permissionCodes - Array of permission codes to check
   * @param userId - User ID to check (optional, defaults to instance userId)
   * @returns Boolean indicating if user has at least one of the permissions
   */
  hasAnyPermission = async (permissionCodes: string[], userId?: string): Promise<boolean> => {
    if (permissionCodes.length === 0) return false;

    const targetUserId = userId || this.userId;

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
   * Check if user has all of the specified permissions (AND logic)
   * @param permissionCodes - Array of permission codes to check
   * @param userId - User ID to check (optional, defaults to instance userId)
   * @returns Boolean indicating if user has all of the permissions
   */
  hasAllPermissions = async (permissionCodes: string[], userId?: string): Promise<boolean> => {
    if (permissionCodes.length === 0) return true;

    const checks = await Promise.all(
      permissionCodes.map((code) => this.hasPermission(code, userId)),
    );
    return checks.every(Boolean);
  };

  /**
   * Get user's active roles
   * @param userId - User ID to query roles for
   * @returns Array of role information
   */
  getUserRoles = async (userId?: string): Promise<RoleItem[]> => {
    const targetUserId = userId || this.userId;

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
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, targetUserId),
          eq(roles.isActive, true),
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
