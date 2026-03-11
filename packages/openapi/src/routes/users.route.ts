import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import { UserController } from '../controllers';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  UpdateUserRolesRequestSchema,
  UserIdParamSchema,
  UserSearchRequestSchema,
} from '../types/user.type';

const UserRoutes = new Hono();

/**
 * 获取当前登录用户信息
 * GET /api/v1/users/me
 * 需要认证，但不需要特殊权限
 */
UserRoutes.get('/me', requireAuth, async (c) => {
  const userController = new UserController();
  return await userController.getCurrentUser(c);
});

/**
 * 获取系统中的用户列表 (支持搜索)
 * GET /api/v1/users?keyword=xxx&page=1&pageSize=10
 * 需要用户管理权限
 */
UserRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(getScopePermissions('USER_READ', ['ALL']), '您没有权限查看用户列表'),
  zValidator('query', UserSearchRequestSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.queryUsers(c);
  },
);

/**
 * 创建新用户
 * POST /api/v1/users
 * 需要用户创建权限
 */
UserRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(getScopePermissions('USER_CREATE', ['ALL']), '您没有权限创建用户'),
  zValidator('json', CreateUserRequestSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.createUser(c);
  },
);

/**
 * 根据ID获取用户详情
 * GET /api/v1/users/:id
 * 需要用户读取权限
 */
UserRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('USER_READ'), '您没有权限查看用户详情'),
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.getUserById(c);
  },
);

/**
 * 更新用户信息 (RESTful 部分更新)
 * PATCH /api/v1/users/:id
 * 需要用户更新权限
 */
UserRoutes.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('USER_UPDATE'), '您没有权限更新用户信息'),
  zValidator('param', UserIdParamSchema),
  zValidator('json', UpdateUserRequestSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.updateUser(c);
  },
);

/**
 * 删除用户
 * DELETE /api/v1/users/:id
 * 需要用户删除权限
 */
UserRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('USER_DELETE'), '您没有权限删除用户'),
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.deleteUser(c);
  },
);

/**
 * 获取用户角色信息
 * GET /api/v1/users/:id/roles
 * 需要用户角色查看权限
 */
UserRoutes.get(
  '/:id/roles',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('RBAC_USER_ROLE_READ'), '您没有权限查看用户角色'),
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.getUserRoles(c);
  },
);

/**
 * 更新用户关联的角色
 * PATCH /api/v1/users/:id/roles
 * 需要用户角色分配权限
 */
UserRoutes.patch(
  '/:id/roles',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('RBAC_USER_ROLE_UPDATE'), '您没有权限分配用户角色'),
  zValidator('param', UserIdParamSchema),
  zValidator('json', UpdateUserRolesRequestSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.updateUserRoles(c);
  },
);

/**
 * 清空用户的角色列表
 * DELETE /api/v1/users/:id/roles
 * 需要用户角色更新权限
 */
UserRoutes.delete(
  '/:id/roles',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('RBAC_USER_ROLE_UPDATE'),
    '您没有权限清空该用户的角色',
  ),
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.clearUserRoles(c);
  },
);

export default UserRoutes;
