import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { RoleService } from '../services/role.service';
import type {
  CreateRoleRequest,
  RolePermissionsListQuery,
  RolesListQuery,
  UpdateRolePermissionsRequest,
  UpdateRoleRequest,
} from '../types/role.type';

/**
 * Role controller class
 * Handle role-related HTTP requests and responses
 */
export class RoleController extends BaseController {
  /**
   * Get all roles in the system
   * @param c Hono Context
   * @returns Role list response
   */
  async getRoles(c: Context): Promise<Response> {
    try {
      // Get database connection and create service instance
      const request = this.getQuery<RolesListQuery>(c);

      const db = await this.getDatabase();
      const roleService = new RoleService(db, this.getUserId(c));
      const roles = await roleService.getRoles(request);

      return this.success(c, roles, 'Get roles list successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Create a new role
   */
  async createRole(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreateRoleRequest>(c);

      if (!body) {
        return this.error(c, '请求体不能为空', 400);
      }

      const db = await this.getDatabase();
      const roleService = new RoleService(db, this.getUserId(c));
      const createdRole = await roleService.createRole(body);

      return this.success(c, createdRole, '角色创建成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Get role by ID
   * @param c Hono Context
   * @returns Role detail response
   */
  async getRoleById(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const roleId = id;
      const db = await this.getDatabase();
      const roleService = new RoleService(db, this.getUserId(c));
      const role = await roleService.getRoleById(roleId);

      if (!role) {
        return this.error(c, 'Role not found', 404);
      }

      return this.success(c, role, 'Get role details successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Get role permissions by role ID
   * @param c Hono Context
   * @returns Role permissions response
   */
  async getRolePermissions(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const request = this.getQuery<RolePermissionsListQuery>(c);

      const db = await this.getDatabase();
      const roleService = new RoleService(db, this.getUserId(c));

      const permissions = await roleService.getRolePermissions({ roleId: id, ...request });

      return this.success(c, permissions, 'Get role permissions successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Update role permissions by grant/revoke
   */
  async updateRolePermissions(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateRolePermissionsRequest>(c);

      if (!body) {
        return this.error(c, '请求体不能为空', 400);
      }

      const db = await this.getDatabase();
      const roleService = new RoleService(db, this.getUserId(c));
      const result = await roleService.updateRolePermissions(id, body);

      return this.success(c, result, '角色权限更新成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Clear role permissions mapping
   * DELETE /api/v1/roles/:id/permissions
   */
  async clearRolePermissions(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const roleId = id;
      const db = await this.getDatabase();
      const roleService = new RoleService(db, this.getUserId(c));
      const result = await roleService.clearRolePermissions(roleId);

      return this.success(c, result, '角色权限已清空');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Update role information by ID
   * PATCH /api/v1/roles/:id
   * @param c Hono Context
   * @returns Updated role response
   */
  async updateRole(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdateRoleRequest>(c);

      if (!body) {
        return this.error(c, '请求体不能为空', 400);
      }

      const db = await this.getDatabase();
      const roleService = new RoleService(db, this.getUserId(c));
      const updatedRole = await roleService.updateRole(id, body);

      return this.success(c, updatedRole, '角色更新成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Delete role by ID
   */
  async deleteRole(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const db = await this.getDatabase();
      const roleService = new RoleService(db, this.getUserId(c));
      const result = await roleService.deleteRole(id);

      return this.success(c, result, '角色删除成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
