import debug from 'debug';
import type { Context } from 'hono';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { scmEnv } from '@/envs/scm';
import { buildGitHubInstallUrl } from '@/server/services/scm/github/app';
import { issueScmInstallState } from '@/server/services/scm/oauth/stateStore';
import { canWriteScmScope, sanitizeReturnTo } from '@/server/services/scm/scope';

const log = debug('lobe-server:scm:github-install');

export const GITHUB_INSTALL_PATH = '/api/webhooks/github/install';

/**
 * Entry point for "Connect GitHub". Always reached from a signed-in LobeHub
 * page, so the session tells us which user (and optionally which workspace)
 * the installation should bind to; that binding is carried through GitHub in
 * the single-use `state` and consumed by the callback.
 */
export const githubInstall = async (c: Context): Promise<Response> => {
  if (!scmEnv.ENABLED_GITHUB_APP) {
    return new Response('GitHub App is not configured on this LobeHub deployment.', {
      status: 503,
    });
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
    const callbackUrl = encodeURIComponent(`${GITHUB_INSTALL_PATH}${url.search}`);
    return Response.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, url.origin), 302);
  }
  const userId = session.user.id;

  // Viewers read a workspace; binding an installation writes into it.
  if (workspaceId && !(await canWriteScmScope(await getServerDB(), userId, workspaceId))) {
    return c.json({ error: 'installing into this workspace needs the member role' }, 403);
  }

  const state = await issueScmInstallState({ lobeUserId: userId, returnTo, workspaceId });
  const installUrl = buildGitHubInstallUrl(state);
  if (!installUrl) return new Response('GitHub App slug is not configured.', { status: 503 });

  log('redirecting user=%s workspace=%s to install', userId, workspaceId ?? '-');
  return Response.redirect(installUrl, 302);
};
