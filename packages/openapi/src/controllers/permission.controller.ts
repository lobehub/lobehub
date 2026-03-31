import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { PermissionService } from '../services/permission.service';
import type {
  CreatePermissionRequest,
  PermissionsListQuery,
  UpdatePermissionRequest,
} from '../types/permission.type';

/**
 * Permission controller class
 * Handle permission-related HTTP requests and responses
 */
export class PermissionController extends BaseController {
  /**
   * Get permission list
   */
  async getPermissions(c: Context): Promise<Response> {
    try {
      const query = this.getQuery<PermissionsListQuery>(c);

      const db = await this.getDatabase();
      const permissionService = new PermissionService(db, this.getUserId(c));
      const permissions = await permissionService.getPermissions(query);

      return this.success(c, permissions, 'Get permission list successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Get permission detail by ID
   */
  async getPermissionById(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const db = await this.getDatabase();
      const permissionService = new PermissionService(db, this.getUserId(c));
      const permission = await permissionService.getPermissionById(id);

      if (!permission) {
        return this.error(c, 'Permission not found', 404);
      }

      return this.success(c, permission, 'Get permission successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Create a new permission
   */
  async createPermission(c: Context): Promise<Response> {
    try {
      const body = await this.getBody<CreatePermissionRequest>(c);

      if (!body) {
        return this.error(c, '请求体不能为空', 400);
      }

      const db = await this.getDatabase();
      const permissionService = new PermissionService(db, this.getUserId(c));
      const created = await permissionService.createPermission(body);

      return this.success(c, created, 'Permission created successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Update permission by ID
   */
  async updatePermission(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const body = await this.getBody<UpdatePermissionRequest>(c);

      if (!body) {
        return this.error(c, '请求体不能为空', 400);
      }

      const db = await this.getDatabase();
      const permissionService = new PermissionService(db, this.getUserId(c));
      const updated = await permissionService.updatePermission(id, body);

      return this.success(c, updated, 'Permission updated successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Delete permission by ID
   */
  async deletePermission(c: Context): Promise<Response> {
    try {
      const { id } = this.getParams<{ id: string }>(c);
      const db = await this.getDatabase();
      const permissionService = new PermissionService(db, this.getUserId(c));
      const result = await permissionService.deletePermission(id);

      return this.success(c, result, 'Permission deleted successfully');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
