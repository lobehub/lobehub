import debug from 'debug';

import { auth } from '@/auth';
import { getMessengerSlackConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import { buildInstallUrl } from '@/server/services/messenger/oauth/slackOAuth';
import { issueOAuthState } from '@/server/services/messenger/oauth/stateStore';

const log = debug('lobe-server:messenger:slack-install');

/**
 * Bot scopes requested at install. Keep in sync with
 * `docs/development/messenger/slack-app-manifest.yaml` — Slack rejects the
 * install with `invalid_scope` if the App's manifest doesn't authorise
 * everything we ask for.
 *
 * Deliberately narrower than the per-agent bot path documented at
 * `docs/usage/channels/slack.zh-CN.mdx`. The two products are different:
 *
 *   - per-agent bot = user installs their own Slack App for a single agent;
 *     wants @mention in channels, slash commands, channel/group history,
 *     reactions, Slack AI assistant — needs the full set
 *   - LobeHub messenger v1 = official LobeHub-distributed Marketplace App,
 *     DM-only, agent-as-coworker (Manus pattern). Channel @mention / slash
 *     commands / channel history land in PR3 (LOBE-8424); each addition
 *     triggers Marketplace re-review so we batch them
 *
 * `reactions:write` is included because `AgentBridgeService.handleMention`
 * uses emoji reactions (👀 "processing" → ✅ "done") for inline feedback —
 * this is core UX even in DM-only mode. `reactions:read` is NOT needed: we
 * never react to users' own reactions in v1.
 */
const BOT_SCOPES = [
  'chat:write',
  'im:history',
  'im:read',
  'im:write',
  'reactions:write',
  'users:read',
  'users:read.email',
];

/**
 * Entry point for the workspace install flow. Always reached from the LobeHub
 * web settings (the "Connect Slack" modal `window.location.href`s here) so we
 * require an authenticated session — that's how we capture which LobeHub
 * user owns this install (`messenger_installations.installed_by_user_id`).
 *
 * Manus's flow is the same shape: install starts on the product, NOT on a
 * public Marketplace deep link, so the install row is bound to a real user
 * end-to-end. See the Linear issue LOBE-8424 screenshots for the UX target.
 */
export const GET = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // 1. Session check — unauth users get bounced through sign-in and back.
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: req.headers });
  } catch (error) {
    log('install: getSession failed: %O', error);
    session = null;
  }
  if (!session?.user?.id) {
    const callbackUrl = encodeURIComponent('/api/agent/messenger/slack/install');
    return Response.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, url.origin), 302);
  }

  // 2. Config precondition — give a clear 503 instead of letting Slack reject us.
  const config = await getMessengerSlackConfig();
  if (!config) {
    log('install: Slack messenger not configured');
    return new Response(
      'Slack messenger is not configured on this LobeHub deployment. ' +
        'Ask the operator to add a Slack bot in dc-center → Agent → System Bots ' +
        '(appId / clientId / clientSecret / signingSecret) and enable it.',
      { status: 503 },
    );
  }

  if (!appEnv.APP_URL) {
    log('install: APP_URL not set, cannot build redirect_uri');
    return new Response('APP_URL is not configured', { status: 503 });
  }

  // 3. Mint an OAuth state, store the originating user → Redis (10-min TTL).
  const returnTo = url.searchParams.get('returnTo') || undefined;
  const state = await issueOAuthState({ lobeUserId: session.user.id, returnTo });

  // 4. Build the Slack authorize URL and 302.
  const redirectUri = `${appEnv.APP_URL.replace(/\/$/, '')}/api/agent/messenger/slack/oauth/callback`;
  const authorizeUrl = buildInstallUrl({
    clientId: config.clientId,
    redirectUri,
    scopes: BOT_SCOPES,
    state,
  });

  log('install: redirecting user=%s to Slack authorize', session.user.id);
  return Response.redirect(authorizeUrl, 302);
};
