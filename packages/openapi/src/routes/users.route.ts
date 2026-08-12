import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
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
UserRoutes.get(
  '/me',
  describeRoute({ summary: 'Get current authenticated user', tags: ['users'] }),
  requireAuth,
  // Deliberately reachable by every authenticated caller, including restricted
  // API keys holding no `user:read` — please do not add a scope gate here.
  // This is how `lh login` resolves a userId from a freshly minted key
  // (`apps/cli/src/auth/apiKey.ts`); gating the route strands the holder of a
  // valid key outside the product with a scope error, same reason GitHub keeps
  // `/user` open to any token.
  //
  // Reachability is not disclosure: the payload is scoped inside
  // `UserController.getCurrentUser` — a key without `user:read` receives only
  // `{ id }`, and `messageCount` additionally needs `chat:read`. Widen there,
  // under a scope check, rather than by gating the route. See LOBE-12934.
  async (c) => {
    const userController = new UserController();
    return await userController.getCurrentUser(c);
  },
);

/**
 * Get the list of users in the system (supports search)
 * GET /api/v1/users?keyword=xxx&page=1&pageSize=10
 * Requires user management permission
 */
UserRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(
    getScopePermissions('USER_READ', ['ALL']),
    'You do not have permission to view user list',
  ),
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
  requireAnyPermission(
    getScopePermissions('USER_CREATE', ['ALL']),
    'You do not have permission to create a user',
  ),
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
  requireAnyPermission(
    getAllScopePermissions('USER_READ'),
    'You do not have permission to view user details',
  ),
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
  requireAnyPermission(
    getAllScopePermissions('USER_UPDATE'),
    'You do not have permission to update user information',
  ),
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
  requireAnyPermission(
    getAllScopePermissions('USER_DELETE'),
    'You do not have permission to delete a user',
  ),
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
  requireAnyPermission(
    getAllScopePermissions('RBAC_USER_ROLE_READ'),
    'You do not have permission to view user roles',
  ),
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
  requireAnyPermission(
    getAllScopePermissions('RBAC_USER_ROLE_UPDATE'),
    'You do not have permission to assign user roles',
  ),
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
