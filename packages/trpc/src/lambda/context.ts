import { type Context as OtContext } from '@lobechat/observability-otel/api';
import { type ClientSecretPayload, type SpendOrigin } from '@lobechat/types';
import type { ClientMetadata } from '@lobechat/utils/server';
import { parseClientMetadata } from '@lobechat/utils/server';
import { parse } from 'cookie';
import debug from 'debug';
import { type NextRequest } from 'next/server';

import { auth } from '@/auth';
import { canUseWorkspaceApiKeys } from '@/business/server/workspaceApiKey';
import { getServerDB } from '@/database/core/db-adaptor';
import { ApiKeyModel } from '@/database/models/apiKey';
import { hasActiveWorkspaceMembership } from '@/database/models/workspace';
import { authEnv, LOBE_CHAT_OIDC_AUTH_HEADER } from '@/envs/auth';
import { extractTraceContext } from '@/libs/observability/traceparent';
import { assertOIDCUserActive, isOIDCUserInactiveError } from '@/libs/oidc-provider/access-control';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { isApiKeyExpired, validateApiKeyFormat } from '@/utils/apiKey';

import { HETERO_OPERATION_JWT_PURPOSE } from '../utils/internalJwt';

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

interface ValidatedApiKey {
  scopes: string[] | null;
  userId: string;
  workspaceId: string | null;
}

const validateApiKey = async (apiKey: string): Promise<ValidatedApiKey | null> => {
  if (!validateApiKeyFormat(apiKey)) return null;

  try {
    const db = await getServerDB();
    const apiKeyRecord = await ApiKeyModel.findByKey(db, apiKey);

    if (!apiKeyRecord) return null;
    if (!apiKeyRecord.enabled) return null;
    if (isApiKeyExpired(apiKeyRecord.expiresAt)) return null;

    const userApiKeyModel = new ApiKeyModel(
      db,
      apiKeyRecord.userId,
      apiKeyRecord.workspaceId ?? undefined,
    );
    void userApiKeyModel.updateLastUsed(apiKeyRecord.id).catch((error) => {
      log('Failed to update API key last used timestamp: %O', error);
      console.error('Failed to update API key last used timestamp:', error);
    });

    return {
      scopes: apiKeyRecord.scopes ?? null,
      userId: apiKeyRecord.userId,
      workspaceId: apiKeyRecord.workspaceId ?? null,
    };
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
  /**
   * Set only when the request authenticated via an API key: the key's
   * capability scopes (`null` = full-access key). `undefined` means the
   * request used another auth method and scope enforcement does not apply.
   */
  apiKeyScopes?: string[] | null;
  clientIp?: string | null;
  clientMetadata?: ClientMetadata;
  jwtPayload?: ClientSecretPayload | null;
  marketAccessToken?: string;
  // Add OIDC authentication information
  oidcAuth?: OIDCAuth | null;
  oidcClientId?: string;
  resHeaders?: Headers;
  /**
   * Origin attribution for spend produced by this call, forwarded to the
   * billing points the procedure reaches.
   *
   * SECURITY: never derived from request headers or any other client input —
   * it decides who a charge is billed against, so a client could otherwise
   * forge another user's attribution. Populated ONLY by a server-side
   * `createCaller` (see the tool-execution server runtimes), where the values
   * come from the already-authorized run context.
   */
  spendOrigin?: SpendOrigin;
  traceContext?: OtContext;
  userAgent?: string;
  userId?: string | null;
  workspaceId?: string | null;
}

/**
 * Inner function for `createContext` where we create the context.
 * This is useful for testing when we don't want to mock Next.js' request/response
 */
export const createContextInner = async (params?: {
  apiKeyScopes?: string[] | null;
  clientMetadata?: ClientMetadata;
  clientIp?: string | null;
  marketAccessToken?: string;
  oidcAuth?: OIDCAuth | null;
  oidcClientId?: string;
  /** See {@link AuthContext.spendOrigin} — server-side callers only. */
  spendOrigin?: SpendOrigin;
  traceContext?: OtContext;
  userAgent?: string;
  userId?: string | null;
  workspaceId?: string | null;
}): Promise<AuthContext> => {
  log('createContextInner called with params: %O', params);
  const responseHeaders = new Headers();

  return {
    apiKeyScopes: params?.apiKeyScopes,
    clientMetadata: params?.clientMetadata || { type: 'unknown' },
    clientIp: params?.clientIp,
    marketAccessToken: params?.marketAccessToken,
    oidcAuth: params?.oidcAuth,
    oidcClientId: params?.oidcClientId,
    resHeaders: responseHeaders,
    spendOrigin: params?.spendOrigin,
    traceContext: params?.traceContext,
    userAgent: params?.userAgent,
    userId: params?.userId,
    workspaceId: params?.workspaceId,
  };
};

export type LambdaContext = Awaited<ReturnType<typeof createContextInner>>;

/**
 * Creates context for an incoming request
 * @link https://trpc.io/docs/v11/context
 */
export const createLambdaContext = async (request: NextRequest): Promise<LambdaContext> => {
  const clientMetadata = parseClientMetadata(request.headers);

  // we have a special header to debug the api endpoint in development mode
  // IT WON'T GO INTO PRODUCTION ANYMORE
  const isDebugApi = request.headers.get('lobe-auth-dev-backend-api') === '1';
  const isMockUser = process.env.ENABLE_MOCK_DEV_USER === '1';

  if (process.env.NODE_ENV === 'development' && (isDebugApi || isMockUser)) {
    return createContextInner({
      clientMetadata,
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
  const workspaceId = request.headers.get('X-Workspace-Id')?.trim() || undefined;

  const commonContext = {
    clientMetadata,
    clientIp,
    marketAccessToken,
    userAgent,
    workspaceId,
  };

  const apiKeyToken = request.headers.get(LOBE_CHAT_API_KEY_HEADER)?.trim();
  log('X-API-Key header: %s', apiKeyToken ? 'exists' : 'not found');

  if (apiKeyToken) {
    const apiKeyAuth = await validateApiKey(apiKeyToken);

    if (!apiKeyAuth) {
      log('API key authentication failed; rejecting request without fallback auth');

      return createContextInner({
        ...commonContext,
        traceContext,
        userId: null,
      });
    }

    // Bind the key to its workspace, mirroring the OpenAPI surface
    // (`resolveWorkspaceId` in packages/openapi): a personal key must not reach
    // workspace data, and a workspace key must not be replayed against another
    // workspace via the caller-supplied X-Workspace-Id header.
    if (!apiKeyAuth.workspaceId && workspaceId) {
      log('Personal API key cannot access workspace data; rejecting request');

      return createContextInner({
        ...commonContext,
        traceContext,
        userId: null,
        workspaceId: undefined,
      });
    }

    if (apiKeyAuth.workspaceId && workspaceId && workspaceId !== apiKeyAuth.workspaceId) {
      log('Workspace API key cannot access a different workspace; rejecting request');

      return createContextInner({
        ...commonContext,
        traceContext,
        userId: null,
        workspaceId: undefined,
      });
    }

    // Same gates as the OpenAPI workspace middleware: the issuer must remain
    // an active member, and the workspace must retain its API-key entitlement.
    // Current RBAC is evaluated later and intersects with the key's scopes, so
    // a role downgrade automatically narrows even a full-access key.
    if (apiKeyAuth.workspaceId) {
      const db = await getServerDB();
      const isActiveMember = await hasActiveWorkspaceMembership(db, {
        userId: apiKeyAuth.userId,
        workspaceId: apiKeyAuth.workspaceId,
      });

      if (!isActiveMember) {
        log('Workspace API key issuer is no longer an active member; rejecting request');

        return createContextInner({
          ...commonContext,
          traceContext,
          userId: null,
          workspaceId: undefined,
        });
      }

      if (!(await canUseWorkspaceApiKeys(apiKeyAuth.workspaceId))) {
        log('Workspace API key access is not available for this workspace; rejecting request');

        return createContextInner({
          ...commonContext,
          traceContext,
          userId: null,
          workspaceId: undefined,
        });
      }
    }

    log('API key authentication successful, userId: %s', apiKeyAuth.userId);

    return createContextInner({
      ...commonContext,
      apiKeyScopes: apiKeyAuth.scopes,
      traceContext,
      userId: apiKeyAuth.userId,
      workspaceId: apiKeyAuth.workspaceId ?? undefined,
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
        // Validate the stateless JWT first, then check the current user state
        // so banned/deleted accounts cannot keep using an already-issued token.
        const tokenInfo = await validateOIDCJWT(oidcAuthToken);

        const operationClaims =
          tokenInfo.tokenData.purpose === HETERO_OPERATION_JWT_PURPOSE
            ? {
                capabilities: tokenInfo.payload.capabilities,
                iss: tokenInfo.payload.iss,
                model: tokenInfo.payload.model,
                operation_id: tokenInfo.payload.operation_id,
                provider_id: tokenInfo.payload.provider_id,
                workspace_id: tokenInfo.payload.workspace_id,
              }
            : undefined;
        oidcAuth = {
          payload: tokenInfo.tokenData,
          ...tokenInfo.tokenData, // Spread payload into oidcAuth
          ...operationClaims,
          sub: tokenInfo.userId, // Use tokenData as payload
        };
        userId = tokenInfo.userId;
        const db = await getServerDB();
        await assertOIDCUserActive(db, userId);
        log('OIDC authentication successful, userId: %s', userId);

        const oidcClientId =
          typeof tokenInfo.clientId === 'string' ? tokenInfo.clientId : undefined;

        // If OIDC authentication is successful, return context immediately
        log('OIDC authentication successful, creating context and returning');
        return createContextInner({
          oidcAuth,
          oidcClientId,
          ...commonContext,
          traceContext,
          userId,
        });
      }
    } catch (error) {
      if (isOIDCUserInactiveError(error)) {
        log('OIDC user is inactive, rejecting request without fallback auth');
        console.error('OIDC authentication failed for inactive user:', error);
        return createContextInner({
          ...commonContext,
          traceContext,
          userId: null,
        });
      }

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
