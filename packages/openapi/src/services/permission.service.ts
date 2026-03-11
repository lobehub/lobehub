import { and, count, desc, eq, ilike, or } from 'drizzle-orm';

import type { PermissionItem } from '@/database/schemas/rbac';
import { permissions, rolePermissions } from '@/database/schemas/rbac';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import type { ServiceResult } from '../types';
import type {
  CreatePermissionRequest,
  PermissionsListQuery,
  PermissionsListResponse,
  UpdatePermissionRequest,
} from '../types/permission.type';

export class PermissionService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
  }

  /**
   * Get permission list with optional filters
   */
  async getPermissions(queryParams: PermissionsListQuery): ServiceResult<PermissionsListResponse> {
    try {
      const conditions = [];

      if (queryParams.active !== undefined) {
        conditions.push(eq(permissions.isActive, queryParams.active));
      }

      if (queryParams.category) {
        conditions.push(eq(permissions.category, queryParams.category));
      }

      if (queryParams.keyword) {
        const keyword = `%${queryParams.keyword}%`;
        conditions.push(
          or(
            ilike(permissions.code, keyword),
            ilike(permissions.name, keyword),
            ilike(permissions.description, keyword),
          ),
        );
      }

      const whereExpr = conditions.length ? and(...conditions) : undefined;

      const { limit, offset } = processPaginationConditions(queryParams);

      const listQuery = this.db.query.permissions.findMany({
        limit,
        offset,
        orderBy: desc(permissions.createdAt),
        where: whereExpr,
      });

      const countQuery = this.db.select({ count: count() }).from(permissions).where(whereExpr);

      const [listResult, totalResult] = await Promise.all([listQuery, countQuery]);

      return {
        permissions: listResult,
        total: totalResult[0]?.count || 0,
      };
    } catch (error) {
      this.handleServiceError(error, '获取权限列表');
    }
  }

  /**
   * Get permission detail by ID
   */
  async getPermissionById(id: string): ServiceResult<PermissionItem | null> {
    try {
      const permission = await this.db.query.permissions.findFirst({
        where: eq(permissions.id, id),
      });

      return permission || null;
    } catch (error) {
      this.handleServiceError(error, '获取权限详情');
    }
  }

  /**
   * Create a new permission record
   */
  async createPermission(payload: CreatePermissionRequest): ServiceResult<PermissionItem> {
    try {
      // Ensure permission code is unique
      const existing = await this.db.query.permissions.findFirst({
        where: eq(permissions.code, payload.code),
      });

      if (existing) {
        throw this.createBusinessError(`Permission code "${payload.code}" already exists`);
      }

      const [created] = await this.db
        .insert(permissions)
        .values({
          category: payload.category,
          code: payload.code,
          description: payload.description ?? null,
          isActive: payload.isActive ?? true,
          name: payload.name,
        })
        .returning();

      return created;
    } catch (error) {
      this.handleServiceError(error, '创建权限');
    }
  }

  /**
   * Update permission information by ID
   */
  async updatePermission(
    id: string,
    payload: UpdatePermissionRequest,
  ): ServiceResult<PermissionItem> {
    try {
      const existingPermission = await this.db.query.permissions.findFirst({
        where: eq(permissions.id, id),
      });

      if (!existingPermission) {
        throw this.createNotFoundError(`Permission ID "${id}" does not exist`);
      }

      if (payload.code && payload.code !== existingPermission.code) {
        const duplicate = await this.db.query.permissions.findFirst({
          where: eq(permissions.code, payload.code),
        });

        if (duplicate) {
          throw this.createBusinessError(`Permission code "${payload.code}" already exists`);
        }
      }

      const updateFields = {
        ...(payload.category !== undefined && { category: payload.category }),
        ...(payload.code !== undefined && { code: payload.code }),
        ...(payload.description !== undefined && { description: payload.description }),
        ...(payload.isActive !== undefined && { isActive: payload.isActive }),
        ...(payload.name !== undefined && { name: payload.name }),
        updatedAt: new Date(),
      };

      if (Object.keys(updateFields).length === 1) {
        throw this.createBusinessError('No fields provided for update');
      }

      const [updated] = await this.db
        .update(permissions)
        .set(updateFields)
        .where(eq(permissions.id, id))
        .returning();

      return updated;
    } catch (error) {
      this.handleServiceError(error, '更新权限');
    }
  }

  /**
   * Delete permission by ID
   */
  async deletePermission(id: string): ServiceResult<{ id: string }> {
    try {
      const existingPermission = await this.db.query.permissions.findFirst({
        where: eq(permissions.id, id),
      });

      if (!existingPermission) {
        throw this.createNotFoundError(`Permission ID "${id}" does not exist`);
      }

      // Prevent deleting permissions that are still linked to roles
      const linkedRolePermission = await this.db.query.rolePermissions.findFirst({
        where: eq(rolePermissions.permissionId, id),
      });

      if (linkedRolePermission) {
        throw this.createBusinessError('Permission is assigned to roles and cannot be deleted');
      }

      const [deleted] = await this.db
        .delete(permissions)
        .where(eq(permissions.id, id))
        .returning({ id: permissions.id });

      if (!deleted) {
        throw this.createBusinessError('Failed to delete permission');
      }

      return deleted;
    } catch (error) {
      this.handleServiceError(error, '删除权限');
    }
  }
}
