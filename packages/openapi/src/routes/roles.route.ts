import { Hono } from 'hono';

import { getScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { RoleController } from '../controllers/role.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import {
  CreateRoleRequestSchema,
  RoleIdParamSchema,
  RoleListSchema,
  RolePermissionListSchema,
  RolePermissionsListQuerySchema,
  RolePermissionsUpdateResultSchema,
  RoleSchema,
  RolesListQuerySchema,
  UpdateRolePermissionsRequestSchema,
  UpdateRoleRequestSchema,
} from '../types/role.type';

const RolesRoutes = new Hono();

/**
 * Get all roles in the system
 * GET /api/v1/roles - Get all roles in the system
 * Requires role read permission (specific scopes)
 */
RolesRoutes.get(
  '/',
  routeDoc({ data: RoleListSchema, summary: 'List roles', tags: ['roles'] }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_ROLE_READ', ['ALL']),
    'You do not have permission to view roles list',
  ),
  zValidator('query', RolesListQuerySchema),
  async (c) => {
    const roleController = new RoleController();

    return await roleController.getRoles(c);
  },
);

/**
 * Create a new role
 * POST /api/v1/roles - Create a new role
 */
RolesRoutes.post(
  '/',
  routeDoc({ data: RoleSchema, summary: 'Create a role', tags: ['roles'] }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_ROLE_CREATE', ['ALL']),
    'You do not have permission to create a role',
  ),
  zValidator('json', CreateRoleRequestSchema),
  async (c) => {
    const roleController = new RoleController();

    return await roleController.createRole(c);
  },
);

/**
 * Get role by ID
 * GET /api/v1/roles/:id - Get role details
 * Requires role read permission (specific scopes)
 */
RolesRoutes.get(
  '/:id',
  routeDoc({ data: RoleSchema, errors: [404], summary: 'Get a role', tags: ['roles'] }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_ROLE_READ', ['ALL']),
    'You do not have permission to view role details',
  ),
  zValidator('param', RoleIdParamSchema),
  async (c) => {
    const roleController = new RoleController();

    return await roleController.getRoleById(c);
  },
);

/**
 * Get role permissions mapping
 * GET /api/v1/roles/:id/permissions - Get role permissions mapping
 */
RolesRoutes.get(
  '/:id/permissions',
  routeDoc({
    data: RolePermissionListSchema,
    summary: "List a role's permissions",
    tags: ['roles'],
  }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_ROLE_READ', ['ALL']),
    'You do not have permission to view role permissions',
  ),
  zValidator('param', RoleIdParamSchema),
  zValidator('query', RolePermissionsListQuerySchema),
  async (c) => {
    const roleController = new RoleController();

    return roleController.getRolePermissions(c);
  },
);

/**
 * Update role permissions
 * PATCH /api/v1/roles/:id/permissions - Update role permissions list
 */
RolesRoutes.patch(
  '/:id/permissions',
  routeDoc({
    data: RolePermissionsUpdateResultSchema,
    description: 'Grants and revokes permissions by id; returns how many mappings changed.',
    errors: [404],
    summary: "Update a role's permissions",
    tags: ['roles'],
  }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_ROLE_UPDATE', ['ALL']),
    'You do not have permission to update role permissions',
  ),
  zValidator('param', RoleIdParamSchema),
  zValidator('json', UpdateRolePermissionsRequestSchema),
  async (c) => {
    const roleController = new RoleController();

    return roleController.updateRolePermissions(c);
  },
);

/**
 * Clear role permissions mapping
 * DELETE /api/v1/roles/:id/permissions - Clear role permissions list
 */
RolesRoutes.delete(
  '/:id/permissions',
  routeDoc({
    data: DeletedResourcesSchema,
    description: '`count` is the number of permission mappings removed.',
    errors: [404],
    summary: "Clear a role's permissions",
    tags: ['roles'],
  }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_ROLE_UPDATE', ['ALL']),
    'You do not have permission to clear role permissions',
  ),
  zValidator('param', RoleIdParamSchema),
  async (c) => {
    const roleController = new RoleController();

    return roleController.clearRolePermissions(c);
  },
);

/**
 * Update role information
 * PATCH /api/v1/roles/:id - Update role information
 * Requires role update permission (admin only)
 */
RolesRoutes.patch(
  '/:id',
  routeDoc({ data: RoleSchema, errors: [404], summary: 'Update a role', tags: ['roles'] }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_ROLE_UPDATE', ['ALL']),
    'You do not have permission to update role information',
  ),
  zValidator('param', RoleIdParamSchema),
  zValidator('json', UpdateRoleRequestSchema),
  async (c) => {
    const roleController = new RoleController();

    return await roleController.updateRole(c);
  },
);

/**
 * Delete role by ID
 * DELETE /api/v1/roles/:id - Delete role
 */
RolesRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    summary: 'Delete a role',
    tags: ['roles'],
  }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_ROLE_DELETE', ['ALL']),
    'You do not have permission to delete a role',
  ),
  zValidator('param', RoleIdParamSchema),
  async (c) => {
    const roleController = new RoleController();

    return await roleController.deleteRole(c);
  },
);

export default RolesRoutes;
