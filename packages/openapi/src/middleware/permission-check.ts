import debug from 'debug';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { ApiKeyScope } from '@/const/apiKeyScope';
import {
  hasApiKeyScope,
  isFullAccessApiKey,
  requiredApiKeyScopeForPermission,
} from '@/const/apiKeyScope';
import { getServerDB } from '@/database/core/db-adaptor';
import { RbacModel } from '@/database/models/rbac';

// Create context logger namespace
const log = debug('lobe-hono:permission-middleware');

export interface PermissionCheckOptions {
  /**
   * Explicit scope for API-key-authenticated requests when the public API
   * capability does not map 1:1 to the RBAC resource used for issuer checks.
   * This only changes the API key narrowing step; RBAC is still enforced.
   */
  apiKeyScope?: ApiKeyScope;

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
/**
 * Enforce the API key's capability scopes against the RBAC permissions a
 * route declares. Effective permission = issuer's RBAC ∩ key scopes: RBAC is
 * checked elsewhere; this narrows API-key-authenticated requests further.
 *
 * No-op for non-API-key auth and for full-access keys. For restricted keys,
 * `operator: 'OR'` needs at least one declared permission whose mapped scope
 * the key holds; `'AND'` needs all of them. Permissions that map to no scope
 * (api_key/rbac/roles) can never be satisfied by a restricted key.
 */
const assertApiKeyScopesAllow = (
  c: Context,
  permissionCodes: string[],
  operator: 'AND' | 'OR',
  apiKeyScope?: ApiKeyScope,
) => {
  if (c.get('authType') !== 'apikey') return;

  const scopes = c.get('apiKeyScopes') as string[] | null | undefined;
  if (isFullAccessApiKey(scopes)) return;

  const requiredScopes = apiKeyScope
    ? [apiKeyScope]
    : permissionCodes.map((code) => requiredApiKeyScopeForPermission(code));
  const satisfies = (scope: ApiKeyScope | null) => !!scope && hasApiKeyScope(scopes, scope);
  const allowed =
    operator === 'AND' ? requiredScopes.every(satisfies) : requiredScopes.some(satisfies);

  if (!allowed) {
    const missing = [...new Set(requiredScopes.filter(Boolean) as string[])];

    throw new HTTPException(403, {
      cause: { missingScopes: missing, requiredPermissions: permissionCodes },
      message:
        missing.length > 0
          ? `insufficient_scope: this API key is missing required scope(s): ${missing.join(', ')}`
          : 'insufficient_scope: this operation is not available to restricted API keys',
    });
  }
};

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
      const workspaceId = c.get('workspaceId') as string | undefined;

      let hasPermission = false;
      const operator = options.operator || 'OR';

      log('Checking permissions for user %s: %o (operator: %s)', userId, permissionCodes, operator);

      // Check permissions based on operator
      if (operator === 'AND') {
        hasPermission = await rbacModel.hasAllPermissions(permissionCodes, { userId, workspaceId });
      } else {
        hasPermission = await rbacModel.hasAnyPermission(permissionCodes, { userId, workspaceId });
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

      // RBAC passed — now narrow by the API key's capability scopes
      assertApiKeyScopesAllow(c, permissionCodes, operator, options.apiKeyScope);

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

/**
 * Require issuer RBAC while projecting the route onto an explicit API key
 * scope. Use this for public capabilities such as MCP configuration or usage
 * summaries whose RBAC permission belongs to a different internal resource.
 */
export const requireAnyPermissionWithApiKeyScope = (
  permissionCodes: string[],
  apiKeyScope: ApiKeyScope,
  errorMessage?: string,
) => {
  return requirePermission({
    apiKeyScope,
    errorMessage,
    operator: 'OR',
    permissions: permissionCodes,
  });
};

/**
 * Standalone API key scope gate for routes that declare no RBAC permissions
 * (e.g. `POST /responses`). No-op for session/OIDC auth and full-access keys;
 * restricted keys must hold the given scope.
 */
export const requireApiKeyScope = (scope: ApiKeyScope) => {
  return async (c: Context, next: Next) => {
    if (c.get('authType') !== 'apikey') return next();

    const scopes = c.get('apiKeyScopes') as string[] | null | undefined;
    if (!isFullAccessApiKey(scopes) && !hasApiKeyScope(scopes, scope)) {
      throw new HTTPException(403, {
        cause: { missingScopes: [scope] },
        message: `insufficient_scope: this API key is missing required scope '${scope}'`,
      });
    }

    return next();
  };
};
