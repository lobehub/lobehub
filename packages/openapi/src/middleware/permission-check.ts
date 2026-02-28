import debug from 'debug';
import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import { RbacModel } from '@/database/models/rbac';

// Create context logger namespace
const log = debug('lobe-hono:permission-middleware');

export interface PermissionCheckOptions {
  /**
   * Custom error message when permission check fails
   */
  errorMessage?: string;

  /**
   * Logic operator when checking multiple permissions
   * - 'AND': User must have ALL specified permissions
   * - 'OR': User must have AT LEAST ONE of the specified permissions
   * @default 'OR'
   */
  operator?: 'AND' | 'OR';

  /**
   * Permission code(s) to check
   * Can be a single permission code string or an array of permission codes
   */
  permissions: string | string[];

  /**
   * Whether to skip permission check in development mode
   * @default false
   */
  skipInDev?: boolean;
}

/**
 * Create a permission check middleware factory
 * @param options - Permission check configuration
 * @returns Hono middleware function
 */
const requirePermission = (options: PermissionCheckOptions) => {
  return async (c: Context, next: Next) => {
    // Development mode bypass if enabled
    if (options.skipInDev && process.env.NODE_ENV === 'development') {
      log('Development mode: skipping permission check');
      return next();
    }

    // Get user ID from context (set by authentication middleware)
    const userId = c.get('userId');

    if (!userId) {
      log('Permission check failed: user not authenticated');
      throw new HTTPException(401, {
        message: 'Authentication required for permission check',
      });
    }

    // Normalize permissions to array
    const permissionCodes = Array.isArray(options.permissions)
      ? options.permissions
      : [options.permissions];

    if (permissionCodes.length === 0) {
      log('Permission check skipped: no permissions specified');
      return next();
    }

    try {
      // Get database instance
      const serverDB = await getServerDB();
      const rbacModel = new RbacModel(serverDB, userId);

      let hasPermission = false;
      const operator = options.operator || 'OR';

      log('Checking permissions for user %s: %o (operator: %s)', userId, permissionCodes, operator);

      // Check permissions based on operator
      if (operator === 'AND') {
        hasPermission = await rbacModel.hasAllPermissions(permissionCodes);
      } else {
        hasPermission = await rbacModel.hasAnyPermission(permissionCodes);
      }

      if (!hasPermission) {
        const errorMessage =
          options.errorMessage ||
          `Insufficient permissions. Required: ${permissionCodes.join(operator === 'AND' ? ' AND ' : ' OR ')}`;

        log('Permission check failed for user %s: %s', userId, errorMessage);

        throw new HTTPException(403, {
          cause: {
            operator,
            requiredPermissions: permissionCodes,
            userId,
          },
          message: errorMessage,
        });
      }

      log('Permission check passed for user %s', userId);

      // Store permission check result in context for potential use in handlers
      c.set('checkedPermissions', {
        granted: true,
        operator,
        permissions: permissionCodes,
      });

      return next();
    } catch (error) {
      // Re-throw HTTPException as-is
      if (error instanceof HTTPException) {
        throw error;
      }

      // Log and wrap other errors
      log('Permission check error for user %s: %O', userId, error);
      throw new HTTPException(500, {
        cause: error,
        message: 'Internal error during permission check',
      });
    }
  };
};

/**
 * Convenience function to require a single permission
 * @param permissionCode - Single permission code to check
 * @param errorMessage - Optional custom error message
 * @returns Hono middleware function
 */
export const requireSinglePermission = (permissionCode: string, errorMessage?: string) => {
  return requirePermission({
    errorMessage,
    permissions: permissionCode,
  });
};

/**
 * Convenience function to require ALL specified permissions
 * @param permissionCodes - Array of permission codes (all required)
 * @param errorMessage - Optional custom error message
 * @returns Hono middleware function
 */
export const requireAllPermissions = (permissionCodes: string[], errorMessage?: string) => {
  return requirePermission({
    errorMessage,
    operator: 'AND',
    permissions: permissionCodes,
  });
};

/**
 * Convenience function to require ANY of the specified permissions
 * @param permissionCodes - Array of permission codes (any one required)
 * @param errorMessage - Optional custom error message
 * @returns Hono middleware function
 */
export const requireAnyPermission = (permissionCodes: string[], errorMessage?: string) => {
  return requirePermission({
    errorMessage,
    operator: 'OR',
    permissions: permissionCodes,
  });
};
