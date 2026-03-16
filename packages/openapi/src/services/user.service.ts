import { and, count, desc, eq, ilike, inArray, ne, or } from 'drizzle-orm';

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
  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
  }

  /**
   * Get user info and role info
   * @param userId User ID
   * @returns User info and role info
   */
  private async getUserWithRoles(userId: string): Promise<UserWithRoles> {
    // Use subquery approach to avoid complex GROUP BY
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw this.createNotFoundError('用户不存在');
    }

    // Fetch roles and message count in parallel for better efficiency
    const [userRoleResults, messageCountResult] = await Promise.all([
      this.db
        .select({ roles })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userId)),

      this.db.select({ count: count() }).from(messages).where(eq(messages.userId, userId)),
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
  async getCurrentUser(): ServiceResult<UserWithRoles> {
    this.log('info', '获取当前登录用户信息及角色信息');

    // Query basic user info
    return this.getUserWithRoles(this.userId!);
  }

  /**
   * Get a paginated list of all users in the system
   * @returns User list (including role info and message count)
   */
  async queryUsers(request: UserListRequest): ServiceResult<UserListResponse> {
    this.log('info', '获取系统中所有用户列表');

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_READ', ALL_SCOPE);

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限查看用户列表');
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

      this.log('info', '成功获取所有用户信息及其角色、sessions和消息数量');

      return {
        total: countResult[0]?.count ?? 0,
        users: usersWithRoles,
      };
    } catch (error) {
      return this.handleServiceError(error, '获取用户列表');
    }
  }

  /**
   * Create a new user
   * @param userData User creation data
   * @returns Created user info (including role info)
   */
  async createUser(userData: CreateUserRequest): ServiceResult<UserWithRoles> {
    this.log('info', '创建新用户', { userData });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_CREATE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限创建用户');
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
          throw this.createBusinessError('指定的用户ID已存在');
        } else if (existingUser.username === rest.username) {
          throw this.createBusinessError('用户名已存在');
        } else if (existingUser.email === rest.email) {
          throw this.createBusinessError('邮箱已存在');
        } else {
          throw this.createBusinessError('用户名、邮箱或ID已存在');
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

      this.log('info', '用户创建成功', { userId: createdUser.id });

      // Return user data including role info
      return this.getUserWithRoles(userId);
    } catch (error) {
      return this.handleServiceError(error, '创建用户');
    }
  }

  /**
   * Update user info
   * @param userId User ID
   * @param userData Update data
   * @returns Updated user info (including role info)
   */
  async updateUser(userId: string, userData: UpdateUserRequest): ServiceResult<UserWithRoles> {
    this.log('info', '更新用户信息', { userData, userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限更新该用户');
      }

      const { roleIds, ...rest } = userData;

      // Check if the user exists
      const existingUser = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!existingUser) {
        throw this.createNotFoundError('用户不存在');
      }

      // Check if the username or email is already used by another user
      if (rest.username && rest.username !== existingUser.username) {
        const existingUserByUsername = await this.db.query.users.findFirst({
          where: and(eq(users.username, rest.username), ne(users.id, userId)),
        });

        if (existingUserByUsername) {
          throw this.createBusinessError('用户名已被其他用户使用');
        }
      }

      if (rest.email && rest.email !== existingUser.email) {
        const existingUserByEmail = await this.db.query.users.findFirst({
          where: and(eq(users.email, rest.email), ne(users.id, userId)),
        });
        if (existingUserByEmail) {
          throw this.createBusinessError('邮箱已被其他用户使用');
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

      this.log('info', '用户信息更新成功', { userId });

      return this.getUserWithRoles(userId);
    } catch (error) {
      return this.handleServiceError(error, '更新用户');
    }
  }

  /**
   * Delete a user
   * @param userId User ID
   * @returns Delete operation result
   */
  async deleteUser(userId: string): ServiceResult<{ id: string }> {
    this.log('info', '删除用户', { userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_DELETE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限删除该用户');
      }

      // Check if the user exists
      const result = await this.db.delete(users).where(eq(users.id, userId));

      if (!result.rowCount) {
        throw this.createNotFoundError('用户不存在');
      }

      this.log('info', '用户删除成功', { userId });

      return { id: userId };
    } catch (error) {
      return this.handleServiceError(error, '删除用户');
    }
  }

  /**
   * Get user info by ID
   * @param userId User ID
   * @returns User info (including role info and message count)
   */
  async getUserById(userId: string): ServiceResult<UserWithRoles> {
    this.log('info', '根据ID获取用户信息', { userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_READ', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限查看该用户信息');
      }

      // Query basic user info
      return this.getUserWithRoles(userId);
    } catch (error) {
      return this.handleServiceError(error, '获取用户信息');
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
      this.log('info', '更新用户角色', {
        addRoles: request.addRoles,
        removeRoles: request.removeRoles,
        userId,
      });

      // Permission validation
      const permissionResult = await this.resolveOperationPermission('RBAC_USER_ROLE_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限更新用户角色');
      }

      return await this.db.transaction(async (tx) => {
        // 1. Validate that the target user exists
        const targetUser = await tx.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!targetUser) {
          throw this.createNotFoundError(`用户 ${userId} 不存在`);
        }

        // 2. Collect all role IDs that need to be validated
        const allRoleIds = new Set<string>();
        request.addRoles?.forEach((role) => allRoleIds.add(role.roleId));
        request.removeRoles?.forEach((roleId) => allRoleIds.add(roleId));

        // 3. Validate that all roles exist and are active
        if (allRoleIds.size > 0) {
          const existingRoles = await tx.query.roles.findMany({
            where: and(inArray(roles.id, Array.from(allRoleIds)), eq(roles.isActive, true)),
          });

          const existingRoleIds = new Set(existingRoles.map((r) => r.id));
          const missingRoleIds = Array.from(allRoleIds).filter((id) => !existingRoleIds.has(id));

          if (missingRoleIds.length > 0) {
            throw this.createBusinessError(`以下角色不存在或未激活: ${missingRoleIds.join(', ')}`);
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
              and(eq(userRoles.userId, userId), inArray(userRoles.roleId, request.removeRoles)),
            );

          this.log('info', '移除用户角色成功');
        }

        // 6. Handle role addition
        if (request.addRoles && request.addRoles.length > 0) {
          const insertData = request.addRoles.map((role) => {
            const data = {
              createdAt: new Date(),
              expiresAt: role.expiresAt ? new Date(role.expiresAt) : null,
              roleId: role.roleId,
              userId,
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
          .where(eq(userRoles.userId, userId));

        this.log('info', '用户角色更新完成', {
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
      return this.handleServiceError(error, '更新用户角色');
    }
  }

  /**
   * Get user role info
   * @param userId User ID
   * @returns User role details
   */
  async getUserRoles(userId: string): ServiceResult<UserRolesResponse> {
    this.log('info', '获取用户角色信息', { userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('USER_READ', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限查看用户角色');
      }

      // First check if the user exists
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        throw this.createNotFoundError(`用户 ID "${userId}" 不存在`);
      }

      // Get user role info
      const results = await this.db
        .select({ role: roles, userRole: userRoles })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, userId));

      return results.map((r) => ({
        expiresAt: r.userRole.expiresAt,
        roleDisplayName: r.role.displayName,
        roleId: r.role.id,
        roleName: r.role.name,
      }));
    } catch (error) {
      return this.handleServiceError(error, '获取用户角色');
    }
  }

  /**
   * Clear all roles for a user
   */
  async clearUserRoles(userId: string): ServiceResult<{ removed: number; userId: string }> {
    this.log('info', '清空用户角色', { userId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('RBAC_USER_ROLE_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限清空用户角色');
      }

      // Check if the user exists
      const exist = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!exist) {
        throw this.createNotFoundError(`用户 ${userId} 不存在`);
      }

      // Count and delete
      const beforeCount = await this.db
        .select({ count: count() })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));

      await this.db.delete(userRoles).where(eq(userRoles.userId, userId));

      return { removed: beforeCount[0]?.count || 0, userId };
    } catch (error) {
      return this.handleServiceError(error, '清空用户角色');
    }
  }
}
