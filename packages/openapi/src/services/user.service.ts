import { and, count, desc, eq, ilike, inArray, isNull, ne, or } from 'drizzle-orm';

import { ALL_SCOPE } from '@/const/rbac';
import { RbacModel } from '@/database/models/rbac';
import { messages, roles, userRoles, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { idGenerator } from '@/database/utils/idGenerator';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import type { ServiceResult } from '../types';
import type {
  CreateUserRequest,
  UpdateUserRequest,
  UpdateUserRolesRequest,
  UserListRequest,
  UserListResponse,
  UserRoleOperationResult,
  UserRolesResponse,
  UserWithRoles,
} from '../types/user.type';

/**
 * User service implementation class
 */
export class UserService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  private getRoleScopeWhere() {
    return this.workspaceId
      ? or(eq(roles.workspaceId, this.workspaceId), isNull(roles.workspaceId))
      : isNull(roles.workspaceId);
  }

  /**
   * Get user info and role info
   * @param userId User ID
   * @returns User info and role info
   */
  private async getUserWithRoles(userId: string, includeCount = true): Promise<UserWithRoles> {
    // Use subquery approach to avoid complex GROUP BY
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw this.createNotFoundError('User not found');
    }

    if (!includeCount) {
      const userRoleResults = await this.db
        .select({ roles })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(eq(userRoles.userId, userId), this.buildPermissionWhere(userRoles, { userId })));

      return {
        ...user,
        roles: userRoleResults.map((r) => r.roles),
      };
    }

    // Fetch roles and message count in parallel for better efficiency
    const [userRoleResults, messageCountResult] = await Promise.all([
      this.db
        .select({ roles })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(eq(userRoles.userId, userId), this.buildPermissionWhere(userRoles, { userId }))),

      this.db
        .select({ count: count() })
        .from(messages)
        .where(this.buildPermissionWhere(messages, { userId })),
    ]);

    return {
      ...user,
      messageCount: messageCountResult[0]?.count || 0,
      roles: userRoleResults.map((r) => r.roles),
    };
  }

  /**
   * Get the currently logged-in user info
   * @returns User info
   */
  async getCurrentUser(includeCount = true): ServiceResult<UserWithRoles> {
    this.log('info', 'get current logged-in user info and role info');

    // Query basic user info
    return this.getUserWithRoles(this.userId!, includeCount);
  }

  /**
   * Get a paginated list of all users in the system
   * @returns User list (including role info and message count)
   */
  async queryUsers(request: UserListRequest): ServiceResult<UserListResponse> {
    this.log('info', 'get all users list in the system');

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_READ', ALL_SCOPE);

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to view user list');
      }

      // Build query conditions
      const conditions = [];

      if (request.keyword) {
        conditions.push(ilike(users.fullName, `%${request.keyword}%`));
      }

      // Get basic user info
      const query = this.db.query.users.findMany({
        ...processPaginationConditions(request),
        orderBy: desc(users.createdAt),
        where: and(...conditions),
      });

      const countQuery = this.db
        .select({ count: count() })
        .from(users)
        .where(and(...conditions));

      const [userList, countResult] = await Promise.all([query, countQuery]);

      // Fetch roles and message count for each user
      const usersWithRoles = await Promise.all(
        userList.map(async (userRow) => {
          const userRoleResults = await this.db
            .select({ roles })
            .from(userRoles)
            .innerJoin(roles, eq(userRoles.roleId, roles.id))
            .where(eq(userRoles.userId, userRow.id));

          const messageCountResult = await this.db
            .select({ count: count(messages.id) })
            .from(messages)
            .where(eq(messages.userId, userRow.id));

          return {
            ...userRow,
            messageCount: messageCountResult[0]?.count || 0,
            roles: userRoleResults.map((r) => r.roles),
          };
        }),
      );

      this.log('info', 'Successfully retrieved all user info with roles, sessions and message counts');

      return {
        total: countResult[0]?.count ?? 0,
        users: usersWithRoles,
      };
    } catch (error) {
      return this.handleServiceError(error, 'get user list');
    }
  }

  /**
   * Create a new user
   * @param userData User creation data
   * @returns Created user info (including role info)
   */
  async createUser(userData: CreateUserRequest): ServiceResult<UserWithRoles> {
    this.log('info', 'create new user', { userData });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_CREATE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to create user');
      }

      const { roleIds, ...rest } = userData;

      // Check if the username, email, and ID already exist
      const conditions = [];

      if (rest.username) {
        conditions.push(eq(users.username, rest.username));
      }

      if (rest.email) {
        conditions.push(eq(users.email, rest.email));
      }

      if (rest.id) {
        conditions.push(eq(users.id, rest.id));
      }

      const existingUser =
        conditions.length > 0
          ? await this.db.query.users.findFirst({
              where: or(...conditions),
            })
          : null;

      if (existingUser) {
        if (existingUser.id === rest.id) {
          throw this.createBusinessError('The specified user ID already exists');
        } else if (existingUser.username === rest.username) {
          throw this.createBusinessError('Username already exists');
        } else if (existingUser.email === rest.email) {
          throw this.createBusinessError('Email already exists');
        } else {
          throw this.createBusinessError('Username, email, or ID already exists');
        }
      }

      // Use the user-specified ID or generate a new one
      const userId = rest.id || idGenerator('user');

      // Insert new user; ID uses the user-specified ID or a generated one
      const [createdUser] = await this.db
        .insert(users)
        .values({
          ...rest,
          id: userId,
        })
        .returning();

      // Insert user roles
      if (roleIds && roleIds.length > 0) {
        const rbacModel = new RbacModel(this.db, userId);
        await rbacModel.updateUserRoles(userId, roleIds);
      }

      this.log('info', 'User created successfully', { userId: createdUser.id });

      // Return user data including role info
      return this.getUserWithRoles(userId);
    } catch (error) {
      return this.handleServiceError(error, 'create user');
    }
  }

  /**
   * Update user info
   * @param userId User ID
   * @param userData Update data
   * @returns Updated user info (including role info)
   */
  async updateUser(userId: string, userData: UpdateUserRequest): ServiceResult<UserWithRoles> {
    this.log('info', 'update user info', { userData, userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to update this user');
      }

      const { roleIds, ...rest } = userData;

      // Check if the user exists
      const existingUser = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!existingUser) {
        throw this.createNotFoundError('User not found');
      }

      // Check if the username or email is already used by another user
      if (rest.username && rest.username !== existingUser.username) {
        const existingUserByUsername = await this.db.query.users.findFirst({
          where: and(eq(users.username, rest.username), ne(users.id, userId)),
        });

        if (existingUserByUsername) {
          throw this.createBusinessError('Username is already in use by another user');
        }
      }

      if (rest.email && rest.email !== existingUser.email) {
        const existingUserByEmail = await this.db.query.users.findFirst({
          where: and(eq(users.email, rest.email), ne(users.id, userId)),
        });
        if (existingUserByEmail) {
          throw this.createBusinessError('Email is already in use by another user');
        }
      }

      if (roleIds !== undefined) {
        const rbacModel = new RbacModel(this.db, userId);
        await rbacModel.updateUserRoles(userId, roleIds);
      }

      // Update user info
      await this.db
        .update(users)
        .set({
          ...rest,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      this.log('info', 'User info updated successfully', { userId });

      return this.getUserWithRoles(userId);
    } catch (error) {
      return this.handleServiceError(error, 'update user');
    }
  }

  /**
   * Delete a user
   * @param userId User ID
   * @returns Delete operation result
   */
  async deleteUser(userId: string): ServiceResult<{ id: string }> {
    this.log('info', 'delete user', { userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_DELETE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to delete this user');
      }

      // Check if the user exists
      const result = await this.db.delete(users).where(eq(users.id, userId));

      if (!result.rowCount) {
        throw this.createNotFoundError('User not found');
      }

      this.log('info', 'User deleted successfully', { userId });

      return { id: userId };
    } catch (error) {
      return this.handleServiceError(error, 'delete user');
    }
  }

  /**
   * Get user info by ID
   * @param userId User ID
   * @returns User info (including role info and message count)
   */
  async getUserById(userId: string): ServiceResult<UserWithRoles> {
    this.log('info', 'get user info by ID', { userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_READ', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || "No permission to view this user's info");
      }

      // Query basic user info
      return this.getUserWithRoles(userId);
    } catch (error) {
      return this.handleServiceError(error, 'get user info');
    }
  }

  /**
   * Update user roles
   * @param userId Target user ID
   * @param request Update roles request
   * @returns Operation result and latest user role info
   */
  async updateUserRoles(
    userId: string,
    request: UpdateUserRolesRequest,
  ): ServiceResult<UserRolesResponse> {
    try {
      this.log('info', 'update user roles', {
        addRoles: request.addRoles,
        removeRoles: request.removeRoles,
        userId,
      });

      // Permission validation
      const permissionResult = await this.resolveOperationPermission('RBAC_USER_ROLE_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to update user roles');
      }

      return await this.db.transaction(async (tx) => {
        // 1. Validate that the target user exists
        const targetUser = await tx.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!targetUser) {
          throw this.createNotFoundError(`User ${userId} not found`);
        }

        // 2. Collect all role IDs that need to be validated
        const allRoleIds = new Set<string>();
        request.addRoles?.forEach((role) => allRoleIds.add(role.roleId));
        request.removeRoles?.forEach((roleId) => allRoleIds.add(roleId));

        // 3. Validate that all roles exist and are active
        if (allRoleIds.size > 0) {
          const existingRoles = await tx.query.roles.findMany({
            where: and(
              inArray(roles.id, Array.from(allRoleIds)),
              eq(roles.isActive, true),
              this.getRoleScopeWhere(),
            ),
          });

          const existingRoleIds = new Set(existingRoles.map((r) => r.id));
          const missingRoleIds = Array.from(allRoleIds).filter((id) => !existingRoleIds.has(id));

          if (missingRoleIds.length > 0) {
            throw this.createBusinessError(`The following roles do not exist or are not active: ${missingRoleIds.join(', ')}`);
          }
        }

        const result: UserRoleOperationResult = {
          added: 0,
          errors: [],
          removed: 0,
        };

        // 5. Handle role removal
        if (request.removeRoles && request.removeRoles.length > 0) {
          await tx
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.userId, userId),
                inArray(userRoles.roleId, request.removeRoles),
                this.buildPermissionWhere(userRoles, { userId }),
              ),
            );

          this.log('info', 'User roles removed successfully');
        }

        // 6. Handle role addition
        if (request.addRoles && request.addRoles.length > 0) {
          const insertData = request.addRoles.map((role) => {
            const data = {
              createdAt: new Date(),
              expiresAt: role.expiresAt ? new Date(role.expiresAt) : null,
              roleId: role.roleId,
              userId,
              workspaceId: this.workspaceId ?? null,
            };
            return data;
          });

          await tx.insert(userRoles).values(insertData).onConflictDoNothing().returning();
        }

        // 7. Get the updated user role info
        const userWithRoles = await tx
          .select({ role: roles, userRole: userRoles })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .innerJoin(users, eq(userRoles.userId, users.id))
          .where(
            and(eq(userRoles.userId, userId), this.buildPermissionWhere(userRoles, { userId })),
          );

        this.log('info', 'User roles update completed', {
          result,
          totalRoles: userWithRoles.length,
          userId,
        });

        return userWithRoles.map((r) => ({
          expiresAt: r.userRole.expiresAt,
          roleDisplayName: r.role.displayName,
          roleId: r.role.id,
          roleName: r.role.name,
        }));
      });
    } catch (error) {
      return this.handleServiceError(error, 'update user roles');
    }
  }

  /**
   * Get user role info
   * @param userId User ID
   * @returns User role details
   */
  async getUserRoles(userId: string): ServiceResult<UserRolesResponse> {
    this.log('info', 'get user role info', { userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_READ', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to view user roles');
      }

      // First check if the user exists
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        throw this.createNotFoundError(`User ID "${userId}" not found`);
      }

      // Get user role info
      const results = await this.db
        .select({ role: roles, userRole: userRoles })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(and(eq(userRoles.userId, userId), this.buildPermissionWhere(userRoles, { userId })));

      return results.map((r) => ({
        expiresAt: r.userRole.expiresAt,
        roleDisplayName: r.role.displayName,
        roleId: r.role.id,
        roleName: r.role.name,
      }));
    } catch (error) {
      return this.handleServiceError(error, 'get user roles');
    }
  }

  /**
   * Clear all roles for a user
   */
  async clearUserRoles(userId: string): ServiceResult<{ removed: number; userId: string }> {
    this.log('info', 'clear user roles', { userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('RBAC_USER_ROLE_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || 'No permission to clear user roles');
      }

      // Check if the user exists
      const exist = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!exist) {
        throw this.createNotFoundError(`User ${userId} not found`);
      }

      // Count and delete
      const beforeCount = await this.db
        .select({ count: count() })
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), this.buildPermissionWhere(userRoles, { userId })));

      await this.db
        .delete(userRoles)
        .where(and(eq(userRoles.userId, userId), this.buildPermissionWhere(userRoles, { userId })));

      return { removed: beforeCount[0]?.count || 0, userId };
    } catch (error) {
      return this.handleServiceError(error, 'clear user roles');
    }
  }
}
