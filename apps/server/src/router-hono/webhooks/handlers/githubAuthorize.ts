import debug from 'debug';
import type { Context } from 'hono';

import { auth } from '@/auth';
import { scmEnv } from '@/envs/scm';
import { buildGitHubAuthorizeUrl } from '@/server/services/scm/github/app';
import { issueScmInstallState } from '@/server/services/scm/oauth/stateStore';
import { sanitizeReturnTo } from '@/server/services/scm/scope';

const log = debug('lobe-server:scm:github-authorize');

export const GITHUB_AUTHORIZE_PATH = '/api/webhooks/github/authorize';
const GITHUB_OAUTH_CALLBACK_PATH = '/api/webhooks/github/oauth/callback';

export const githubAuthorize = async (c: Context): Promise<Response> => {
  if (!scmEnv.ENABLED_GITHUB_APP || !scmEnv.ENABLED_GITHUB_APP_OAUTH) {
    return new Response(
      'GitHub account authorization is not configured on this LobeHub deployment.',
      {
        status: 503,
      },
    );
  }

  const req = c.req.raw;
  const url = new URL(req.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));

  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: req.headers });
  } catch (error) {
    log('getSession failed: %O', error);
    session = null;
  }
  if (!session?.user?.id) {
    const callbackUrl = encodeURIComponent(`${GITHUB_AUTHORIZE_PATH}${url.search}`);
    return Response.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, url.origin), 302);
  }

  let state: string;
  try {
    state = await issueScmInstallState({
      lobeUserId: session.user.id,
      purpose: 'authorize',
      returnTo,
    });
  } catch (error) {
    log('cannot issue authorize state: %O', error);
    return new Response('Connecting GitHub needs Redis (REDIS_URL) on this LobeHub deployment.', {
      status: 503,
    });
  }

  const authorizeUrl = buildGitHubAuthorizeUrl(
    state,
    new URL(GITHUB_OAUTH_CALLBACK_PATH, url.origin).toString(),
  );
  if (!authorizeUrl)
    return new Response('GitHub App client id is not configured.', { status: 503 });

  return Response.redirect(authorizeUrl, 302);
};
