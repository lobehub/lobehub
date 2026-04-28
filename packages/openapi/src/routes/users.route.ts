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
 * Get current logged-in user information
 * GET /api/v1/users/me
 * Requires authentication but no special permission
 */
UserRoutes.get('/me', requireAuth, async (c) => {
  const userController = new UserController();
  return await userController.getCurrentUser(c);
});

/**
 * Get the list of users in the system (supports search)
 * GET /api/v1/users?keyword=xxx&page=1&pageSize=10
 * Requires user management permission
 */
UserRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(getScopePermissions('USER_READ', ['ALL']), 'You do not have permission to view user list'),
  zValidator('query', UserSearchRequestSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.queryUsers(c);
  },
);

/**
 * Create a new user
 * POST /api/v1/users
 * Requires user create permission
 */
UserRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(getScopePermissions('USER_CREATE', ['ALL']), 'You do not have permission to create a user'),
  zValidator('json', CreateUserRequestSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.createUser(c);
  },
);

/**
 * Get user details by ID
 * GET /api/v1/users/:id
 * Requires user read permission
 */
UserRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('USER_READ'), 'You do not have permission to view user details'),
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.getUserById(c);
  },
);

/**
 * Update user information (RESTful partial update)
 * PATCH /api/v1/users/:id
 * Requires user update permission
 */
UserRoutes.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('USER_UPDATE'), 'You do not have permission to update user information'),
  zValidator('param', UserIdParamSchema),
  zValidator('json', UpdateUserRequestSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.updateUser(c);
  },
);

/**
 * Delete a user
 * DELETE /api/v1/users/:id
 * Requires user delete permission
 */
UserRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('USER_DELETE'), 'You do not have permission to delete a user'),
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.deleteUser(c);
  },
);

/**
 * Get user role information
 * GET /api/v1/users/:id/roles
 * Requires user role read permission
 */
UserRoutes.get(
  '/:id/roles',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('RBAC_USER_ROLE_READ'), 'You do not have permission to view user roles'),
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.getUserRoles(c);
  },
);

/**
 * Update the roles associated with a user
 * PATCH /api/v1/users/:id/roles
 * Requires user role assignment permission
 */
UserRoutes.patch(
  '/:id/roles',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('RBAC_USER_ROLE_UPDATE'), 'You do not have permission to assign user roles'),
  zValidator('param', UserIdParamSchema),
  zValidator('json', UpdateUserRolesRequestSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.updateUserRoles(c);
  },
);

/**
 * Clear all roles for a user
 * DELETE /api/v1/users/:id/roles
 * Requires user role update permission
 */
UserRoutes.delete(
  '/:id/roles',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('RBAC_USER_ROLE_UPDATE'),
    'You do not have permission to clear user roles',
  ),
  zValidator('param', UserIdParamSchema),
  async (c) => {
    const userController = new UserController();
    return await userController.clearUserRoles(c);
  },
);

export default UserRoutes;
