import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { RBAC_PERMISSIONS } from '@/const/rbac';
import { getServerDB } from '@/database/core/db-adaptor';
import { RbacModel } from '@/database/models/rbac';
import { LobeChatDatabase } from '@/database/type';

import { parseFormData } from '../helpers/file';
import { ApiResponse } from '../types';

/**
 * Base Controller Class
 * Provides unified response formatting, error handling, and common utility methods
 */
export abstract class BaseController {
  private _db: LobeChatDatabase | null = null;

  /**
   * Get database connection instance
   * Lazy initialization to avoid initializing the database during module import
   */
  protected async getDatabase(): Promise<LobeChatDatabase> {
    if (!this._db) {
      this._db = await getServerDB();
    }
    return this._db;
  }

  /**
   * Success response formatting
   * @param c Hono Context
   * @param data Response data
   * @param message Response message
   * @returns Formatted success response
   */
  protected success<T>(c: Context, data?: T, message?: string): Response {
    const response: ApiResponse<T> = {
      data,
      message,
      success: true,
      timestamp: new Date().toISOString(),
    };

    return c.json(response);
  }

  /**
   * Error response formatting
   * @param c Hono Context
   * @param error Error message
   * @param statusCode HTTP status code, default 500
   * @returns Formatted error response
   */
  protected error(c: Context, error: string, statusCode: number = 500): Response {
    const response: ApiResponse = {
      error,
      success: false,
      timestamp: new Date().toISOString(),
    };

    return c.json(response, statusCode as any);
  }

  /**
   * Unified exception handling
   * @param c Hono Context
   * @param error Exception object
   * @returns Formatted error response
   */
  protected handleError(c: Context, error: unknown): Response {
    console.error('Controller Error:', error);

    // Handle HTTPException
    if (error instanceof HTTPException) {
      return this.error(c, error.message, error.status);
    }

    // Handle other known error types
    if (error instanceof Error) {
      // Handle business logic errors
      if (error.name === 'BusinessError') {
        return this.error(c, error.message, 400);
      }

      // Handle authentication errors
      if (error.name === 'AuthenticationError') {
        return this.error(c, error.message, 401);
      }

      // Handle authorization errors
      if (error.name === 'AuthorizationError') {
        return this.error(c, error.message, 403);
      }

      // Handle not found errors
      if (error.name === 'NotFoundError') {
        return this.error(c, error.message, 404);
      }

      // Other errors
      return this.error(c, error.message, 500);
    }

    // Unknown error
    return this.error(c, 'Internal Server Error', 500);
  }

  /**
   * Get request parameters
   * @param c Hono Context
   * @returns Request parameters object
   */
  protected getParams<T = any>(c: Context): T {
    // @ts-ignore
    return c.req.valid('param') as T;
  }

  /**
   * Get query parameters
   * @param c Hono Context
   * @returns Query parameters object
   */
  protected getQuery<T = any>(c: Context): T {
    // @ts-ignore
    return c.req.valid('query') as T;
  }

  /**
   * Get request body
   * @param c Hono Context
   * @returns Request body object
   */
  protected async getBody<T = any>(c: Context): Promise<T> {
    // @ts-ignore
    return c.req.valid('json') as T;
  }

  /**
   * Get request form data
   * @param c Hono Context
   * @returns Request form data object
   */
  protected async getFormData<T = any>(c: Context): Promise<T> {
    return parseFormData(c) as T;
  }

  /**
   * Get user ID (from context set by middleware)
   * @param c Hono Context
   * @returns User ID, returns null if not authenticated
   */
  protected getUserId(c: Context): string | null {
    return c.get('userId') || null;
  }

  /**
   * Get authentication type (from context set by middleware)
   * @param c Hono Context
   * @returns Authentication type, returns null if not authenticated
   */
  protected getAuthType(c: Context): string | null {
    return c.get('authType') || null;
  }

  /**
   * Get authentication data (from context set by middleware)
   * @param c Hono Context
   * @returns Authentication data object, returns null if not authenticated
   */
  protected getAuthData(c: Context): any | null {
    return c.get('authData') || null;
  }

  /**
   * Get RBAC model instance
   * @param c Hono Context
   * @returns RBAC model instance
   */
  protected async getRbacModel(c: Context): Promise<RbacModel> {
    const db = await this.getDatabase();
    return new RbacModel(db, this.getUserId(c)!);
  }

  /**
   * Check if user has specific permission
   * @param c Hono Context
   * @param permission Permission string (e.g., 'session:read:all')
   * @returns Promise<boolean>
   */
  protected async hasPermission(
    c: Context,
    permissionKey: keyof typeof RBAC_PERMISSIONS,
  ): Promise<boolean> {
    const rbacModel = await this.getRbacModel(c);

    return await rbacModel.hasPermission(RBAC_PERMISSIONS[permissionKey], this.getUserId(c)!);
  }

  /**
   * Check permission and throw error if not authorized
   * @param c Hono Context
   * @param permission Permission string
   * @param errorMessage Custom error message
   * @throws HTTPException if permission denied
   */
  protected async requirePermission(
    c: Context,
    permission: keyof typeof RBAC_PERMISSIONS,
    errorMessage?: string,
  ): Promise<void> {
    const hasPermission = await this.hasPermission(c, permission);
    if (!hasPermission) {
      throw new HTTPException(403, {
        message: errorMessage || `您没有权限执行此操作：${permission}`,
      });
    }
  }

  /**
   * Check if user has any of the specified permissions
   * @param c Hono Context
   * @param permissions Array of permission strings
   * @returns Promise<boolean>
   */
  protected async hasAnyPermission(
    c: Context,
    permissionKeys: (keyof typeof RBAC_PERMISSIONS)[],
  ): Promise<boolean> {
    const permissions = permissionKeys.map((permission) => RBAC_PERMISSIONS[permission]);

    const rbacModel = await this.getRbacModel(c);
    return await rbacModel.hasAnyPermission(permissions, this.getUserId(c)!);
  }

  /**
   * Check any permission and throw error if not authorized
   * @param c Hono Context
   * @param permissions Array of permission strings
   * @param errorMessage Custom error message
   * @throws HTTPException if permission denied
   */
  protected async requireAnyPermission(
    c: Context,
    permissionKeys: (keyof typeof RBAC_PERMISSIONS)[],
    errorMessage?: string,
  ): Promise<void> {
    const hasPermission = await this.hasAnyPermission(c, permissionKeys);
    if (!hasPermission) {
      throw new HTTPException(403, {
        message:
          errorMessage ||
          `您没有权限执行此操作，需要以下权限之一：${permissionKeys
            .map((key) => RBAC_PERMISSIONS[key])
            .join(', ')}`,
      });
    }
  }
}
