import { type Context as OtContext } from '@lobechat/observability-otel/api';
import { type ClientSecretPayload } from '@lobechat/types';
import { parse } from 'cookie';
import debug from 'debug';
import { type NextRequest } from 'next/server';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { ApiKeyModel } from '@/database/models/apiKey';
import { authEnv, LOBE_CHAT_OIDC_AUTH_HEADER } from '@/envs/auth';
import { extractTraceContext } from '@/libs/observability/traceparent';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { isApiKeyExpired, validateApiKeyFormat } from '@/utils/apiKey';

// Create context logger namespace
const log = debug('lobe-trpc:lambda:context');
const LOBE_CHAT_API_KEY_HEADER = 'X-API-Key';

const extractClientIp = (request: NextRequest): string | undefined => {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ip = forwardedFor.split(',')[0]?.trim();
    if (ip) return ip;
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return undefined;
};

const validateApiKeyUserId = async (apiKey: string): Promise<string | null> => {
  if (!validateApiKeyFormat(apiKey)) return null;

  try {
    const db = await getServerDB();
    const apiKeyRecord = await ApiKeyModel.findByKey(db, apiKey);

    if (!apiKeyRecord) return null;
    if (!apiKeyRecord.enabled) return null;
    if (isApiKeyExpired(apiKeyRecord.expiresAt)) return null;

    const userApiKeyModel = new ApiKeyModel(db, apiKeyRecord.userId);
    void userApiKeyModel.updateLastUsed(apiKeyRecord.id).catch((error) => {
      log('Failed to update API key last used timestamp: %O', error);
      console.error('Failed to update API key last used timestamp:', error);
    });

    return apiKeyRecord.userId;
  } catch (error) {
    log('API key authentication failed: %O', error);
    console.error('API key authentication failed, trying other methods:', error);
    return null;
  }
};

export interface OIDCAuth {
  // Other OIDC information that might be needed (optional, as payload contains all info)
  [key: string]: any;
  // OIDC token data (now the complete payload)
  payload: any;
  // User ID
  sub: string;
}

export interface AuthContext {
  clientIp?: string | null;
  jwtPayload?: ClientSecretPayload | null;
  marketAccessToken?: string;
  // Add OIDC authentication information
  oidcAuth?: OIDCAuth | null;
  resHeaders?: Headers;
  traceContext?: OtContext;
  userAgent?: string;
  userId?: string | null;
}

/**
 * Inner function for `createContext` where we create the context.
 * This is useful for testing when we don't want to mock Next.js' request/response
 */
export const createContextInner = async (params?: {
  clientIp?: string | null;
  marketAccessToken?: string;
  oidcAuth?: OIDCAuth | null;
  traceContext?: OtContext;
  userAgent?: string;
  userId?: string | null;
}): Promise<AuthContext> => {
  log('createContextInner called with params: %O', params);
  const responseHeaders = new Headers();

  return {
    clientIp: params?.clientIp,
    marketAccessToken: params?.marketAccessToken,
    oidcAuth: params?.oidcAuth,
    resHeaders: responseHeaders,
    traceContext: params?.traceContext,
    userAgent: params?.userAgent,
    userId: params?.userId,
  };
};

export type LambdaContext = Awaited<ReturnType<typeof createContextInner>>;

/**
 * Creates context for an incoming request
 * @link https://trpc.io/docs/v11/context
 */
export const createLambdaContext = async (request: NextRequest): Promise<LambdaContext> => {
  // we have a special header to debug the api endpoint in development mode
  // IT WON'T GO INTO PRODUCTION ANYMORE
  const isDebugApi = request.headers.get('lobe-auth-dev-backend-api') === '1';
  const isMockUser = process.env.ENABLE_MOCK_DEV_USER === '1';

  if (process.env.NODE_ENV === 'development' && (isDebugApi || isMockUser)) {
    return createContextInner({
      userId: process.env.MOCK_DEV_USER_ID,
    });
  }

  log('createLambdaContext called for request');
  // for API-response caching see https://trpc.io/docs/v11/caching

  const userAgent = request.headers.get('user-agent') || undefined;
  const clientIp = extractClientIp(request);

  // get marketAccessToken from cookies
  const cookieHeader = request.headers.get('cookie');
  const cookies = cookieHeader ? parse(cookieHeader) : {};
  const marketAccessToken = cookies['mp_token'];
  // Extract upstream trace context for parent linking
  const traceContext = extractTraceContext(request.headers);

  log('marketAccessToken from cookie:', marketAccessToken ? '[HIDDEN]' : 'undefined');
  const commonContext = {
    clientIp,
    marketAccessToken,
    userAgent,
  };

  const apiKeyToken = request.headers.get(LOBE_CHAT_API_KEY_HEADER)?.trim();
  log('X-API-Key header: %s', apiKeyToken ? 'exists' : 'not found');

  if (apiKeyToken) {
    const apiKeyUserId = await validateApiKeyUserId(apiKeyToken);

    if (!apiKeyUserId) {
      log('API key authentication failed; rejecting request without fallback auth');

      return createContextInner({
        ...commonContext,
        traceContext,
        userId: null,
      });
    }

    log('API key authentication successful, userId: %s', apiKeyUserId);

    return createContextInner({
      ...commonContext,
      traceContext,
      userId: apiKeyUserId,
    });
  }

  let userId;
  let oidcAuth;

  // Prioritize checking for OIDC authentication (both standard Authorization and custom Oidc-Auth headers)
  if (authEnv.ENABLE_OIDC) {
    log('OIDC enabled, attempting OIDC authentication');
    const oidcAuthToken = request.headers.get(LOBE_CHAT_OIDC_AUTH_HEADER);
    log('Oidc-Auth header: %s', oidcAuthToken ? 'exists' : 'not found');

    try {
      if (oidcAuthToken) {
        // Use direct JWT validation instead of database lookup
        const tokenInfo = await validateOIDCJWT(oidcAuthToken);

        oidcAuth = {
          payload: tokenInfo.tokenData,
          ...tokenInfo.tokenData, // Spread payload into oidcAuth
          sub: tokenInfo.userId, // Use tokenData as payload
        };
        userId = tokenInfo.userId;
        log('OIDC authentication successful, userId: %s', userId);

        // If OIDC authentication is successful, return context immediately
        log('OIDC authentication successful, creating context and returning');
        return createContextInner({
          oidcAuth,
          ...commonContext,
          traceContext,
          userId,
        });
      }
    } catch (error) {
      // If OIDC authentication fails, log error and continue with other authentication methods
      if (oidcAuthToken) {
        log('OIDC authentication failed, error: %O', error);
        console.error('OIDC authentication failed, trying other methods:', error);
      }
    }
  }

  // If OIDC is not enabled or validation fails, try Better Auth authentication
  log('Attempting Better Auth authentication');
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (session && session?.user?.id) {
      userId = session.user.id;
      log('Better Auth authentication successful, userId: %s', userId);
    } else {
      log('Better Auth authentication failed, no valid session');
    }

    return createContextInner({
      ...commonContext,
      traceContext,
      userId,
    });
  } catch (e) {
    log('Better Auth authentication error: %O', e);
    console.error('better auth err', e);
  }

  // Final return, userId may be undefined
  log(
    'All authentication methods attempted, returning final context, userId: %s',
    userId || 'not authenticated',
  );
  return createContextInner({ ...commonContext, traceContext, userId });
};
