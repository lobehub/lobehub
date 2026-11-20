import debug from 'debug';
import type { Context } from 'hono';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { linearEnv } from '@/envs/linear';
import { buildLinearAuthorizeUrl, LINEAR_INSTALL_PATH } from '@/server/services/linear/client';
import { redisService } from '@/server/services/redis';
import { canWriteScmScope, sanitizeReturnTo } from '@/server/services/scm/scope';

const log = debug('lobe-server:linear:install');

/**
 * Entry point for "Connect Linear". Reached from a signed-in LobeHub page,
 * so the session says which user (and optionally which workspace) the
 * connection belongs to; that binding travels through Linear in the
 * single-use `state` and is consumed by the callback.
 */
export const linearInstall = async (c: Context): Promise<Response> => {
  if (!linearEnv.ENABLED_LINEAR) {
    return new Response('Linear is not configured on this LobeHub deployment.', { status: 503 });
  }

  const req = c.req.raw;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId');
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));

  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: req.headers });
  } catch (error) {
    log('getSession failed: %O', error);
    session = null;
  }
  if (!session?.user?.id) {
    const callbackUrl = encodeURIComponent(`${LINEAR_INSTALL_PATH}${url.search}`);
    return Response.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, url.origin), 302);
  }
  const userId = session.user.id;

  // Viewers read a workspace; a connection writes tasks into it.
  if (workspaceId && !(await canWriteScmScope(await getServerDB(), userId, workspaceId))) {
    return c.json({ error: 'connecting Linear to this workspace needs the member role' }, 403);
  }

  const state = await redisService.linear
    .issueOAuthState({ lobeUserId: userId, returnTo, workspaceId })
    .catch((error) => {
      log('cannot issue OAuth state: %O', error);
      return null;
    });
  if (!state) {
    return new Response('Connecting Linear needs Redis (REDIS_URL) on this LobeHub deployment.', {
      status: 503,
    });
  }

  const authorizeUrl = buildLinearAuthorizeUrl(state);
  if (!authorizeUrl) return new Response('Linear is not configured.', { status: 503 });

  log('redirecting user=%s workspace=%s to Linear', userId, workspaceId ?? '-');
  return Response.redirect(authorizeUrl, 302);
};
