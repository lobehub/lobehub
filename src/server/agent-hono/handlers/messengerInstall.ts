import debug from 'debug';
import type { Context } from 'hono';

import { auth } from '@/auth';
import { appEnv } from '@/envs/app';
import { issueOAuthState } from '@/server/services/messenger/oauth/stateStore';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';

const log = debug('lobe-server:messenger:install');

/**
 * Generic install entry point for any messenger platform whose definition
 * exposes an OAuth adapter (`MessengerPlatformDefinition.oauth`). The route is
 * platform-agnostic — every Slack-specific concern (scopes, authorize host,
 * deep-link target) lives behind the adapter at
 * `platforms/<id>/oauth.ts`.
 *
 * Always reached from the LobeHub web settings (the "Connect" modal does
 * `window.location.href`s here), so we require an authenticated session —
 * that's how we capture which LobeHub user owns this install
 * (`messenger_installations.installed_by_user_id`).
 *
 * Manus's flow is the same shape: install starts on the product, NOT on a
 * public Marketplace deep link, so the install row is bound to a real user
 * end-to-end.
 */
export async function messengerInstall(c: Context): Promise<Response> {
  const platform = c.req.param('platform');
  if (!platform) {
    return c.json({ error: 'platform is required' }, 400);
  }

  const req = c.req.raw;
  const url = new URL(req.url);

  // 1. Platform definition must exist and expose an OAuth adapter.
  const definition = messengerPlatformRegistry.getPlatform(platform);
  if (!definition?.oauth) {
    log('install: platform %s has no OAuth adapter', platform);
    return new Response(`Messenger platform "${platform}" does not support OAuth install.`, {
      status: 404,
    });
  }

  // 2. Session check — unauth users get bounced through sign-in and back.
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: req.headers });
  } catch (error) {
    log('install: getSession failed: %O', error);
    session = null;
  }
  if (!session?.user?.id) {
    const callbackUrl = encodeURIComponent(`/api/agent/messenger/${platform}/install`);
    return Response.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, url.origin), 302);
  }

  // 3. Config precondition — give a clear 503 instead of letting the upstream reject us.
  const config = await definition.oauth.getAppConfig();
  if (!config) {
    log('install: %s messenger not configured', platform);
    return new Response(
      `${definition.name} messenger is not configured on this LobeHub deployment. ` +
        `Ask the operator to add a ${definition.name} bot in dc-center → Agent → System Bots ` +
        `and enable it.`,
      { status: 503 },
    );
  }

  if (!appEnv.APP_URL) {
    log('install: APP_URL not set, cannot build redirect_uri');
    return new Response('APP_URL is not configured', { status: 503 });
  }

  // 4. Mint an OAuth state, store the originating user → Redis (10-min TTL).
  const returnTo = url.searchParams.get('returnTo') || undefined;
  const state = await issueOAuthState({ lobeUserId: session.user.id, returnTo });

  // 5. Build the platform's authorize URL and 302. The redirect_uri must
  // match exactly at the callback — we generate it the same way both sides.
  const redirectUri = `${appEnv.APP_URL.replace(/\/$/, '')}/api/agent/messenger/${platform}/oauth/callback`;
  const authorizeUrl = definition.oauth.buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri,
    state,
  });

  log('install: redirecting user=%s to %s authorize', session.user.id, platform);
  return Response.redirect(authorizeUrl, 302);
}
