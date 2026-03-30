import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getScopePermissions } from '@/utils/rbac';

import { RoleController } from '../controllers/role.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  CreateRoleRequestSchema,
  RoleIdParamSchema,
  RolePermissionsListQuerySchema,
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
  requireAuth,
  requireAnyPermission(getScopePermissions('RBAC_ROLE_CREATE', ['ALL']), '您没有权限创建角色'),
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
  requireAuth,
  requireAnyPermission(getScopePermissions('RBAC_ROLE_UPDATE', ['ALL']), '您没有权限更新角色权限'),
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
  requireAuth,
  requireAnyPermission(getScopePermissions('RBAC_ROLE_UPDATE', ['ALL']), '您没有权限更新角色信息'),
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
  requireAuth,
  requireAnyPermission(getScopePermissions('RBAC_ROLE_DELETE', ['ALL']), '您没有权限删除角色'),
  zValidator('param', RoleIdParamSchema),
  async (c) => {
    const roleController = new RoleController();

    return await roleController.deleteRole(c);
  },
);

export default RolesRoutes;
