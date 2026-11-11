import { getServerDB } from '@lobechat/database';
import { oidcRefreshTokens } from '@lobechat/database/schemas';
import { and, eq, gt, isNull } from 'drizzle-orm';

import { UserModel } from '@/database/models/user';
import { redisService } from '@/server/services/redis';

import {
  NATIVE_HANDOFF_RATE_WINDOW_SECONDS,
  NativeHandoffError,
  type NativeHandoffRequest,
  NativeHandoffService,
} from './nativeHandoff';
import { getOIDCProvider } from './oidcProvider';

/** Largest JSON body the endpoint reads; a real request is a few hundred bytes. */
const MAX_BODY_BYTES = 4096;

const json = (body: unknown, status = 200) =>
  Response.json(body, { headers: { 'cache-control': 'no-store' }, status });

const errorResponse = (error: unknown) => {
  if (error instanceof NativeHandoffError) return json(error.toJSON(), error.status);

  console.error('[OIDC] native handoff failed', error);
  return json({ error: 'server_error', error_description: 'native handoff failed' }, 500);
};

/** The caller's access token: `Oidc-Auth` like the rest of the desktop API, or a bearer token. */
const readAccessToken = (request: Request) => {
  const oidcAuth = request.headers.get('oidc-auth');
  if (oidcAuth) return oidcAuth;

  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^bearer\s+(.+)$/i);
  return match?.[1];
};

const auditContext = (request: Request) => ({
  ip:
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip'),
  userAgent: request.headers.get('user-agent'),
});

const createService = async () =>
  new NativeHandoffService({
    countRequest: (userId) =>
      redisService.oidcNativeHandoff.countRequest(userId, NATIVE_HANDOFF_RATE_WINDOW_SECONDS),
    findUser: async (userId) => UserModel.findById(await getServerDB(), userId),
    hasLiveSession: async (userId, clientId) => {
      const db = await getServerDB();
      const [row] = await db
        .select({ id: oidcRefreshTokens.id })
        .from(oidcRefreshTokens)
        .where(
          and(
            eq(oidcRefreshTokens.userId, userId),
            eq(oidcRefreshTokens.clientId, clientId),
            isNull(oidcRefreshTokens.consumedAt),
            gt(oidcRefreshTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return !!row;
    },
    provider: await getOIDCProvider(),
  });

/** `GET /oidc/handoff/native`: the native apps this caller may hand its session to. */
export const handleNativeHandoffTargets = async (request: Request) => {
  try {
    const service = await createService();
    return json(await service.listTargets(readAccessToken(request)));
  } catch (error) {
    return errorResponse(error);
  }
};

/** `POST /oidc/handoff/native`: issue a one-time code for a native app. */
export const handleNativeHandoffIssue = async (request: Request) => {
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      throw new NativeHandoffError('invalid_request', 'body must be application/json');
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
      throw new NativeHandoffError('invalid_request', 'body is too large');
    }

    let body: NativeHandoffRequest;
    try {
      body = JSON.parse(text);
    } catch {
      throw new NativeHandoffError('invalid_request', 'body is not valid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new NativeHandoffError('invalid_request', 'body must be a JSON object');
    }

    const service = await createService();
    return json(await service.issue(readAccessToken(request), body, auditContext(request)));
  } catch (error) {
    return errorResponse(error);
  }
};
