import debug from 'debug';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import { ApiKeyModel } from '@/database/models/apiKey';
import { authEnv } from '@/envs/auth';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { validateApiKeyFormat } from '@/utils/apiKey';
import { extractBearerToken } from '@/utils/server/auth';

// Create context logger namespace
const log = debug('lobe-hono:auth-middleware');

// API Key cache configuration
const API_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

interface ApiKeyCacheEntry {
  apiKeyId: string;
  apiKeyName: string;
  expiresAt: Date | null;
  timestamp: number;
  userId: string;
}

// In-memory cache for API Key validation results
const apiKeyCache = new Map<string, ApiKeyCacheEntry>();

/**
 * Clean up expired cache entries periodically
 */
const cleanupApiKeyCache = () => {
  const now = Date.now();
  for (const [key, entry] of apiKeyCache.entries()) {
    if (now - entry.timestamp > API_KEY_CACHE_TTL) {
      apiKeyCache.delete(key);
      log('Removed expired API Key from cache: %s', key.slice(0, 10) + '...');
    }
  }
};

// Run cache cleanup every 10 minutes
setInterval(cleanupApiKeyCache, 10 * 60 * 1000);

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

  // Try Bearer token authentication - check format first to determine type
  if (bearerToken) {
    log('Bearer token received: %s...', bearerToken.slice(0, 10));

    // Check if bearerToken matches API Key format (sk-lh-{16 alphanumeric chars})
    const isApiKeyFormat = validateApiKeyFormat(bearerToken);
    log('API Key format validation result: %s', isApiKeyFormat);

    if (isApiKeyFormat) {
      // Try API Key authentication
      log('Bearer token matches API Key format, attempting API Key authentication');

      // Check cache first
      const cachedEntry = apiKeyCache.get(bearerToken);
      const now = Date.now();

      if (cachedEntry && now - cachedEntry.timestamp < API_KEY_CACHE_TTL) {
        // Check if cached API Key is expired
        const isExpired = cachedEntry.expiresAt && new Date() > new Date(cachedEntry.expiresAt);

        if (!isExpired) {
          userId = cachedEntry.userId;
          authType = 'apikey';
          authData = { apiKeyId: cachedEntry.apiKeyId, apiKeyName: cachedEntry.apiKeyName };

          log(
            'API Key authentication successful (from cache), userId: %s, apiKeyId: %d',
            userId,
            cachedEntry.apiKeyId,
          );
        } else {
          log('Cached API Key is expired, removing from cache');
          apiKeyCache.delete(bearerToken);
        }
      } else {
        // Cache miss or expired, query database
        log('API Key cache miss, querying database');

        try {
          // Get database instance
          const db = await getServerDB();
          log('Database connection established');

          // Find API Key in database
          const apiKeyModel = new ApiKeyModel(db, ''); // userId is not needed for findByKey
          log('Searching for API Key in database...');
          const apiKeyRecord = await apiKeyModel.findByKey(bearerToken);

          log('API Key database query result: %s', apiKeyRecord ? 'found' : 'not found');

          if (apiKeyRecord) {
            log(
              'API Key record - enabled: %s, userId: %s, expiresAt: %s',
              apiKeyRecord.enabled,
              apiKeyRecord.userId,
              apiKeyRecord.expiresAt,
            );
            // Validate API Key is enabled and not expired
            if (apiKeyRecord.enabled) {
              const isExpired =
                apiKeyRecord.expiresAt && new Date() > new Date(apiKeyRecord.expiresAt);

              if (!isExpired) {
                userId = apiKeyRecord.userId;
                authType = 'apikey';
                authData = { apiKeyId: apiKeyRecord.id, apiKeyName: apiKeyRecord.name };

                // Cache the validated API Key
                apiKeyCache.set(bearerToken, {
                  apiKeyId: apiKeyRecord.id,
                  apiKeyName: apiKeyRecord.name,
                  expiresAt: apiKeyRecord.expiresAt,
                  timestamp: now,
                  userId: apiKeyRecord.userId,
                });

                log(
                  'API Key authentication successful, userId: %s, apiKeyId: %d (cached)',
                  userId,
                  apiKeyRecord.id,
                );

                // Update last used timestamp (fire and forget)
                const userApiKeyModel = new ApiKeyModel(db, apiKeyRecord.userId);
                userApiKeyModel.updateLastUsed(apiKeyRecord.id).catch((err) => {
                  log('Failed to update API Key last used timestamp: %O', err);
                });
              } else {
                log('API Key is expired');
              }
            } else {
              log('API Key is disabled');
            }
          } else {
            log('API Key not found in database');
          }
        } catch (error) {
          log('API Key authentication failed: %O', error);
        }
      }
    } else if (authEnv.ENABLE_OIDC) {
      // Try OIDC authentication
      log('Bearer token does not match API Key format, attempting OIDC authentication');

      try {
        // Use direct JWT validation instead of OIDCService
        const tokenInfo = await validateOIDCJWT(bearerToken);

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
