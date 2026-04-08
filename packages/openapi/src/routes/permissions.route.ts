import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getScopePermissions } from '@/utils/rbac';

import { PermissionController } from '../controllers/permission.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  CreatePermissionRequestSchema,
  PermissionIdParamSchema,
  PermissionsListQuerySchema,
  UpdatePermissionRequestSchema,
} from '../types/permission.type';

const PermissionsRoutes = new Hono();

/**
 * Get permission list
 * GET /api/v1/permissions - Get permission list
 */
PermissionsRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_PERMISSION_READ', ['ALL']),
    'You do not have permission to view permissions list',
  ),
  zValidator('query', PermissionsListQuerySchema),
  async (c) => {
    const permissionController = new PermissionController();

    return await permissionController.getPermissions(c);
  },
);

/**
 * Get permission detail by ID
 * GET /api/v1/permissions/:id - Get permission detail
 */
PermissionsRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_PERMISSION_READ', ['ALL']),
    'You do not have permission to view permission details',
  ),
  zValidator('param', PermissionIdParamSchema),
  async (c) => {
    const permissionController = new PermissionController();

    return await permissionController.getPermissionById(c);
  },
);

/**
 * Create a new permission
 * POST /api/v1/permissions - Create a new permission
 */
PermissionsRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_PERMISSION_CREATE', ['ALL']),
    'You do not have permission to create a permission',
  ),
  zValidator('json', CreatePermissionRequestSchema),
  async (c) => {
    const permissionController = new PermissionController();

    return await permissionController.createPermission(c);
  },
);

/**
 * Update permission by ID
 * PATCH /api/v1/permissions/:id - Update permission info
 */
PermissionsRoutes.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_PERMISSION_UPDATE', ['ALL']),
    'You do not have permission to update a permission',
  ),
  zValidator('param', PermissionIdParamSchema),
  zValidator('json', UpdatePermissionRequestSchema),
  async (c) => {
    const permissionController = new PermissionController();

    return await permissionController.updatePermission(c);
  },
);

/**
 * Delete permission by ID
 * DELETE /api/v1/permissions/:id - Delete permission
 */
PermissionsRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getScopePermissions('RBAC_PERMISSION_DELETE', ['ALL']),
    'You do not have permission to delete a permission',
  ),
  zValidator('param', PermissionIdParamSchema),
  async (c) => {
    const permissionController = new PermissionController();

    return await permissionController.deletePermission(c);
  },
);

export default PermissionsRoutes;
