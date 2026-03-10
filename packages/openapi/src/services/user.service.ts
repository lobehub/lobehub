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
 * 用户服务实现类
 */
export class UserService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
  }

  /**
   * 获取用户信息和角色信息
   * @param userId 用户ID
   * @returns 用户信息和角色信息
   */
  private async getUserWithRoles(userId: string): Promise<UserWithRoles> {
    // 使用子查询的方式避免复杂的GROUP BY
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw this.createNotFoundError('用户不存在');
    }

    // 并行获取角色和消息数量，提高效率
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
   * 获取当前登录用户信息
   * @returns 用户信息
   */
  async getCurrentUser(): ServiceResult<UserWithRoles> {
    this.log('info', '获取当前登录用户信息及角色信息');

    // 查询用户基本信息
    return this.getUserWithRoles(this.userId!);
  }

  /**
   * 获取系统中所有用户列表(分页)
   * @returns 用户列表（包含角色信息和消息数量）
   */
  async queryUsers(request: UserListRequest): ServiceResult<UserListResponse> {
    this.log('info', '获取系统中所有用户列表');

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('USER_READ', ALL_SCOPE);

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限查看用户列表');
      }

      // 构建查询条件
      const conditions = [];

      if (request.keyword) {
        conditions.push(ilike(users.fullName, `%${request.keyword}%`));
      }

      // 获取用户基本信息
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

      // 为每个用户获取角色和消息数量
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
   * 创建新用户
   * @param userData 用户创建数据
   * @returns 创建的用户信息（包含角色信息）
   */
  async createUser(userData: CreateUserRequest): ServiceResult<UserWithRoles> {
    this.log('info', '创建新用户', { userData });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('USER_CREATE');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限创建用户');
      }

      const { roleIds, ...rest } = userData;

      // 检查用户名、邮箱和ID是否已存在
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

      // 使用用户指定的ID或生成新的ID
      const userId = rest.id || idGenerator('user');

      // 插入新用户,Id使用用户指定的ID或生成新的ID
      const [createdUser] = await this.db
        .insert(users)
        .values({
          ...rest,
          id: userId,
        })
        .returning();

      // 插入用户角色
      if (roleIds && roleIds.length > 0) {
        const rbacModel = new RbacModel(this.db, userId);
        await rbacModel.updateUserRoles(userId, roleIds);
      }

      this.log('info', '用户创建成功', { userId: createdUser.id });

      // 返回包含角色信息的用户数据
      return this.getUserWithRoles(userId);
    } catch (error) {
      return this.handleServiceError(error, '创建用户');
    }
  }

  /**
   * 更新用户信息
   * @param userId 用户ID
   * @param userData 更新数据
   * @returns 更新后的用户信息（包含角色信息）
   */
  async updateUser(userId: string, userData: UpdateUserRequest): ServiceResult<UserWithRoles> {
    this.log('info', '更新用户信息', { userData, userId });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('USER_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限更新该用户');
      }

      const { roleIds, ...rest } = userData;

      // 检查用户是否存在
      const existingUser = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!existingUser) {
        throw this.createNotFoundError('用户不存在');
      }

      // 检查用户名和邮箱是否被其他用户使用
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

      // 更新用户信息
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
   * 删除用户
   * @param userId 用户ID
   * @returns 删除操作结果
   */
  async deleteUser(userId: string): ServiceResult<{ id: string }> {
    this.log('info', '删除用户', { userId });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('USER_DELETE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限删除该用户');
      }

      // 检查用户是否存在
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
   * 根据ID获取用户信息
   * @param userId 用户ID
   * @returns 用户信息（包含角色信息和消息数量）
   */
  async getUserById(userId: string): ServiceResult<UserWithRoles> {
    this.log('info', '根据ID获取用户信息', { userId });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('USER_READ', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限查看该用户信息');
      }

      // 查询用户基本信息
      return this.getUserWithRoles(userId);
    } catch (error) {
      return this.handleServiceError(error, '获取用户信息');
    }
  }

  /**
   * 更新用户角色
   * @param userId 目标用户ID
   * @param request 更新角色请求
   * @returns 操作结果和最新的用户角色信息
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

      // 权限校验
      const permissionResult = await this.resolveOperationPermission('RBAC_USER_ROLE_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限更新用户角色');
      }

      return await this.db.transaction(async (tx) => {
        // 1. 验证目标用户存在
        const targetUser = await tx.query.users.findFirst({
          where: eq(users.id, userId),
        });

        if (!targetUser) {
          throw this.createNotFoundError(`用户 ${userId} 不存在`);
        }

        // 2. 收集所有需要验证的角色ID
        const allRoleIds = new Set<string>();
        request.addRoles?.forEach((role) => allRoleIds.add(role.roleId));
        request.removeRoles?.forEach((roleId) => allRoleIds.add(roleId));

        // 3. 验证所有角色存在且激活
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

        // 5. 处理移除角色
        if (request.removeRoles && request.removeRoles.length > 0) {
          await tx
            .delete(userRoles)
            .where(
              and(eq(userRoles.userId, userId), inArray(userRoles.roleId, request.removeRoles)),
            );

          this.log('info', '移除用户角色成功');
        }

        // 6. 处理添加角色
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

        // 7. 获取更新后的用户角色信息
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
   * 获取用户的角色信息
   * @param userId 用户ID
   * @returns 用户角色详情
   */
  async getUserRoles(userId: string): ServiceResult<UserRolesResponse> {
    this.log('info', '获取用户角色信息', { userId });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('USER_READ', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限查看用户角色');
      }

      // 先检查用户是否存在
      const user = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        throw this.createNotFoundError(`用户 ID "${userId}" 不存在`);
      }

      // 获取用户的角色信息
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
   * 清空用户的角色列表
   */
  async clearUserRoles(userId: string): ServiceResult<{ removed: number; userId: string }> {
    this.log('info', '清空用户角色', { userId });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('RBAC_USER_ROLE_UPDATE', {
        targetUserId: userId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限清空用户角色');
      }

      // 检查用户是否存在
      const exist = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!exist) {
        throw this.createNotFoundError(`用户 ${userId} 不存在`);
      }

      // 统计并删除
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
