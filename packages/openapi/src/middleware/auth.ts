import debug from 'debug';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import { ApiKeyModel } from '@/database/models/apiKey';
import { authEnv } from '@/envs/auth';
import { assertOIDCUserActive } from '@/libs/oidc-provider/access-control';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { validateApiKeyFormat } from '@/utils/apiKey';
import { extractBearerToken } from '@/utils/server/auth';

// Create context logger namespace
const log = debug('lobe-hono:auth-middleware');

/**
 * Standard Hono authentication middleware
 * Supports both OIDC tokens and API keys via Bearer token
 */
export const userAuthMiddleware = async (c: Context, next: Next) => {
  // Development mode debug bypass
  const isDebugApi = c.req.header('lobe-auth-dev-backend-api') === '1';
  const isMockUser = process.env.ENABLE_MOCK_DEV_USER === '1';
  if (process.env.NODE_ENV === 'development' && (isDebugApi || isMockUser)) {
    log('Development debug mode, using mock user ID');
    c.set('userId', process.env.MOCK_DEV_USER_ID || 'DEV_USER');
    c.set('authType', 'debug');
    return next();
  }

  log('Processing authentication for request: %s %s', c.req.method, c.req.url);

  // Get Authorization header (standard Bearer token)
  const authorizationHeader = c.req.header('Authorization');
  const bearerToken = extractBearerToken(authorizationHeader);

  let userId: string | null = null;
  let authType: string | null = null;
  let authData: any = null;
  let apiKeyWorkspaceId: string | null | undefined;
  // capability scopes of the API key (`null` = full-access key)
  let apiKeyScopes: string[] | null = null;

  // Try Bearer token authentication - check format first to determine type
  if (bearerToken) {
    log('Bearer token received: %s...', bearerToken.slice(0, 10));

    // Check if bearerToken matches API Key format (sk-lh-{16 alphanumeric chars})
    const isApiKeyFormat = validateApiKeyFormat(bearerToken);
    log('API Key format validation result: %s', isApiKeyFormat);

    if (isApiKeyFormat) {
      // Try API Key authentication
      log('Bearer token matches API Key format, attempting API Key authentication');

      // Always read the current row. Scope edits, disable and revoke are
      // authorization changes, so a process-local TTL cache would preserve
      // stale privileges across requests and server instances.
      try {
        const db = await getServerDB();
        const apiKeyRecord = await ApiKeyModel.findByKey(db, bearerToken);

        if (apiKeyRecord?.enabled) {
          const isExpired = apiKeyRecord.expiresAt && new Date() > new Date(apiKeyRecord.expiresAt);

          if (!isExpired) {
            userId = apiKeyRecord.userId;
            authType = 'apikey';
            authData = { apiKeyId: apiKeyRecord.id, apiKeyName: apiKeyRecord.name };
            apiKeyWorkspaceId = apiKeyRecord.workspaceId;
            apiKeyScopes = apiKeyRecord.scopes ?? null;

            log(
              'API Key authentication successful, userId: %s, apiKeyId: %s',
              userId,
              apiKeyRecord.id,
            );

            const userApiKeyModel = new ApiKeyModel(
              db,
              apiKeyRecord.userId,
              apiKeyRecord.workspaceId ?? undefined,
            );
            void userApiKeyModel.updateLastUsed(apiKeyRecord.id).catch((error) => {
              log('Failed to update API Key last used timestamp: %O', error);
            });
          } else {
            log('API Key is expired');
          }
        } else if (apiKeyRecord) {
          log('API Key is disabled');
        } else {
          log('API Key not found in database');
        }
      } catch (error) {
        log('API Key authentication failed: %O', error);
      }
    } else if (authEnv.ENABLE_OIDC) {
      // Try OIDC authentication
      log('Bearer token does not match API Key format, attempting OIDC authentication');

      try {
        // Use direct JWT validation instead of OIDCService
        const tokenInfo = await validateOIDCJWT(bearerToken);
        if (tokenInfo.tokenData?.purpose === 'hetero-operation') {
          throw new Error('Operation tokens are only accepted by heterogeneous model endpoints');
        }
        const db = await getServerDB();
        await assertOIDCUserActive(db, tokenInfo.userId);

        userId = tokenInfo.userId;
        authType = 'oidc';
        authData = tokenInfo.tokenData;

        log('OIDC authentication successful, userId: %s', userId);
      } catch (error) {
        log('OIDC authentication failed: %O', error);
      }
    } else {
      log('Bearer token provided but does not match API Key format and OIDC is not enabled');
    }
  }

  // Set authentication context in Hono context
  if (userId) {
    c.set('userId', userId);
    c.set('authType', authType);
    c.set('authData', authData);
    c.set('authorizationHeader', authorizationHeader);
    c.set('apiKeyWorkspaceId', authType === 'apikey' ? (apiKeyWorkspaceId ?? null) : undefined);
    // `undefined` = not API-key auth; `null` = full-access key
    c.set('apiKeyScopes', authType === 'apikey' ? apiKeyScopes : undefined);

    log('Authentication successful - userId: %s, authType: %s', userId, authType);
  } else {
    log('Authentication failed - no valid credentials found');
    // Don't throw error here, let individual routes decide if auth is required
    c.set('userId', null);
    c.set('authType', null);
  }

  await next();
};

/**
 * Helper middleware to require authentication
 * Throws 401 error if user is not authenticated
 */
export const requireAuth = async (c: Context, next: Next) => {
  const userId = c.get('userId');

  if (!userId) {
    log('Authentication required but user not authenticated');
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  return next();
};
