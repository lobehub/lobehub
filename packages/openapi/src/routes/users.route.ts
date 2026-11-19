import { Hono } from 'hono';
import { z } from 'zod';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { UserController } from '../controllers';
import { UserSettingsController } from '../controllers/user-settings.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requireApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import {
  CreateUserRequestSchema,
  CurrentUserSchema,
  UpdateUserRequestSchema,
  UpdateUserRolesRequestSchema,
  UserIdParamSchema,
  UserListSchema,
  UserRoleSchema,
  UserSchema,
  UserSearchRequestSchema,
} from '../types/user.type';
import {
  UpdateUserProfileRequestSchema,
  UpdateUserSettingsRequestSchema,
  UserProfileSchema,
  UserSettingsSchema,
} from '../types/user-settings.type';

const UserRoutes = new Hono();

/**
 * Get current logged-in user information
 * GET /api/v1/users/me
 * Requires authentication but no special permission
 */
UserRoutes.get(
  '/me',
  routeDoc({
    operationId: 'users.me',
    data: CurrentUserSchema,
    description:
      'Reachable by every authenticated caller. An API key without `user:read` receives only `{ id }`; `messageCount` is included only with `?includeCount=1` and `chat:read`.',
    errors: [404],
    summary: 'Get current authenticated user',
    tags: ['users'],
  }),
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
  // `{ id }`, and `messageCount` is opt-in (`?includeCount=1`) and additionally
  // needs `chat:read`. Widen there,
  // under a scope check, rather than by gating the route.
  async (c) => {
    const userController = new UserController();
    return await userController.getCurrentUser(c);
  },
);

/**
 * The caller's own settings and preference
 * GET /api/v1/users/me/settings
 */
UserRoutes.get(
  '/me/settings',
  routeDoc({
    data: UserSettingsSchema,
    description:
      'Every settings section plus the UI preference. Credentials are never returned: provider / tool keys (`keyVaults`) are managed through `/providers`, and Marketplace tokens are not exposed.',
    operationId: 'users.getSettings',
    summary: 'Get my settings',
    tags: ['users'],
  }),
  requireAuth,
  requireApiKeyScope('user:read'),
  async (c) => new UserSettingsController().getSettings(c),
);

/**
 * Patch the caller's settings and / or preference
 * PATCH /api/v1/users/me/settings
 */
UserRoutes.patch(
  '/me/settings',
  routeDoc({
    data: UserSettingsSchema,
    description:
      'Each settings section sent is deep-merged into the stored one (objects merge key by key; arrays and scalars replace); `preference` merges the same way. Returns the settings after the write. `keyVaults` and `market` are refused (400) — set provider keys through `PATCH /providers/{id}`. Inside a workspace, changing `defaultAgent`, `image`, `memory`, `systemAgent` or `tts` needs the workspace update permission, and `tool` needs agent update permission (403 otherwise).',
    operationId: 'users.updateSettings',
    summary: 'Update my settings',
    tags: ['users'],
  }),
  requireAuth,
  requireApiKeyScope('user:write'),
  zValidator('json', UpdateUserSettingsRequestSchema),
  async (c) => new UserSettingsController().updateSettings(c),
);

/**
 * Update the caller's profile: display name, username, avatar
 * PATCH /api/v1/users/me/profile
 */
UserRoutes.patch(
  '/me/profile',
  routeDoc({
    data: UserProfileSchema,
    description:
      '`avatar` takes a base64 `data:image/png` / `data:image/webp` URL (uploaded to storage; the previous uploaded avatar is deleted), an absolute `http(s)` URL, or `""` to clear. `username` must be unique (409 when another user holds it). Fields are applied username first, so a conflict changes nothing.',
    errors: [409],
    operationId: 'users.updateProfile',
    summary: 'Update my profile',
    tags: ['users'],
  }),
  requireAuth,
  requireApiKeyScope('user:write'),
  zValidator('json', UpdateUserProfileRequestSchema),
  async (c) => new UserSettingsController().updateProfile(c),
);

/**
 * Get the list of users in the system (supports search)
 * GET /api/v1/users?keyword=xxx&page=1&pageSize=10
 * Requires user management permission
 */
UserRoutes.get(
  '/',
  routeDoc({ data: UserListSchema, summary: 'List users', tags: ['users'] }),
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
  routeDoc({ data: UserSchema, summary: 'Create a user', tags: ['users'] }),
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
  routeDoc({ data: UserSchema, errors: [404], summary: 'Get a user', tags: ['users'] }),
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
  routeDoc({ data: UserSchema, errors: [404], summary: 'Update a user', tags: ['users'] }),
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
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    summary: 'Delete a user',
    tags: ['users'],
  }),
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
  routeDoc({
    data: z.array(UserRoleSchema),
    errors: [404],
    summary: "List a user's roles",
    tags: ['users'],
  }),
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
  routeDoc({
    data: z.array(UserRoleSchema),
    description: "Adds and removes role assignments, then returns all of the user's roles.",
    errors: [404],
    summary: "Update a user's roles",
    tags: ['users'],
  }),
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
  routeDoc({
    data: DeletedResourcesSchema,
    description: '`count` is the number of role assignments removed.',
    errors: [404],
    summary: "Clear a user's roles",
    tags: ['users'],
  }),
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
