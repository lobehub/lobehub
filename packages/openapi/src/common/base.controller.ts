import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { RBAC_PERMISSIONS } from '@/const/rbac';
import { getServerDB } from '@/database/core/db-adaptor';
import { RbacModel } from '@/database/models/rbac';
import type { LobeChatDatabase } from '@/database/type';

import { parseFormData } from '../helpers/file';
import type { PaginationRequest } from '../helpers/pagination';
import { buildPageInfo, resolvePagination } from '../helpers/pagination';
import type { ApiResponse } from '../types';
import type { ApiErrorCode } from './errors';
import { errorInitFromException, getRequestId, renderApiError } from './errors';

/**
 * tRPC error codes, mapped to their HTTP equivalents.
 *
 * The REST layer reuses server services that speak tRPC: a guard deep inside
 * one throws `TRPCError({ code: 'NOT_FOUND' })`, and without this map every such
 * refusal surfaces as a 500. Matching on `name`/`code` instead of importing
 * `@trpc/server` keeps the package free of that dependency — `TRPCError` sets
 * `name` to `'TRPCError'`, which is part of its own public shape.
 */
export const TRPC_CODE_TO_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  CLIENT_CLOSED_REQUEST: 499,
  CONFLICT: 409,
  FORBIDDEN: 403,
  INTERNAL_SERVER_ERROR: 500,
  METHOD_NOT_SUPPORTED: 405,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  PRECONDITION_FAILED: 412,
  TIMEOUT: 408,
  TOO_MANY_REQUESTS: 429,
  UNAUTHORIZED: 401,
  UNPROCESSABLE_CONTENT: 422,
};

/** Domain error classes the services throw, by `name`, and the status each answers with. */
const ERROR_NAME_TO_STATUS: Record<string, number> = {
  AuthenticationError: 401,
  AuthorizationError: 403,
  BusinessError: 400,
  ConflictError: 409,
  NotFoundError: 404,
  ValidationError: 400,
};

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
  protected success<T>(c: Context, data?: T, message?: string, statusCode: number = 200): Response {
    const response: ApiResponse<T> = {
      data,
      message,
      success: true,
      timestamp: new Date().toISOString(),
    };

    return c.json(response, statusCode as any);
  }

  /**
   * Success response for one page of an offset-backed list: adds `hasMore`
   * and `nextCursor` (see `helpers/pagination.ts`) to the payload, deriving
   * the page window from the same query the service paginated with.
   * @param key The payload field holding this page's items, e.g. `agents`
   */
  protected list<K extends string, T extends { [P in K]: unknown[] } & { total?: number }>(
    c: Context,
    key: K,
    payload: T,
    {
      defaultLimit,
      message,
      pagination = this.getQuery<PaginationRequest>(c) ?? {},
    }: { defaultLimit?: number; message?: string; pagination?: PaginationRequest } = {},
  ): Response {
    const window = resolvePagination(pagination, defaultLimit);
    return this.success(
      c,
      {
        ...payload,
        ...buildPageInfo({ ...window, returned: payload[key].length, total: payload.total }),
      },
      message,
    );
  }

  /**
   * Error response formatting
   * @param c Hono Context
   * @param error Error message
   * @param statusCode HTTP status code, default 500
   * @param code Catalogue code; inferred from the status when omitted
   * @returns The shared `ApiError` body (or the route's protocol error format)
   */
  protected error(
    c: Context,
    error: string,
    statusCode: number = 500,
    code?: ApiErrorCode,
  ): Response {
    return renderApiError(c, { code, message: error, status: statusCode });
  }

  /**
   * Unified exception handling
   * @param c Hono Context
   * @param error Exception object
   * @returns Formatted error response
   */
  protected handleError(c: Context, error: unknown): Response {
    // The request id ties this log line to the `requestId` the client received.
    console.error(`Controller Error [${getRequestId(c)}]:`, error);

    // Handle HTTPException (including `ApiException`, which carries its code)
    if (error instanceof HTTPException) {
      return renderApiError(c, errorInitFromException(error));
    }

    // Handle other known error types
    if (error instanceof Error) {
      // Refusals raised by the shared server services arrive as tRPC errors;
      // map them back to their HTTP status so a missing agent is a 404, not a 500.
      if (error.name === 'TRPCError') {
        const code = (error as Error & { code?: string }).code;
        return this.error(c, error.message, (code && TRPC_CODE_TO_STATUS[code]) || 500);
      }

      const status = ERROR_NAME_TO_STATUS[error.name];
      if (status) {
        return this.error(
          c,
          error.message,
          status,
          error.name === 'ValidationError' ? 'validation_error' : undefined,
        );
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

  protected getWorkspaceId(c: Context): string | undefined {
    return c.get('workspaceId') || undefined;
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

    return await rbacModel.hasPermission(RBAC_PERMISSIONS[permissionKey], {
      userId: this.getUserId(c)!,
      workspaceId: this.getWorkspaceId(c),
    });
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
        message:
          errorMessage || `You do not have permission to perform this operation: ${permission}`,
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
    return await rbacModel.hasAnyPermission(permissions, {
      userId: this.getUserId(c)!,
      workspaceId: this.getWorkspaceId(c),
    });
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
          `You do not have permission to perform this operation. One of the following permissions is required: ${permissionKeys
            .map((key) => RBAC_PERMISSIONS[key])
            .join(', ')}`,
      });
    }
  }
}
