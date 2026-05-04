import debug from 'debug';

import { getMessengerSlackConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { exchangeCode } from '@/server/services/messenger/oauth/slackOAuth';
import { consumeOAuthState } from '@/server/services/messenger/oauth/stateStore';

const log = debug('lobe-server:messenger:slack-callback');

const SETTINGS_PATH = '/settings/messenger';

const redirectToSettings = (origin: string, query?: string): Response => {
  const target = new URL(SETTINGS_PATH + (query ? `?${query}` : ''), origin);
  return Response.redirect(target, 302);
};

/**
 * OAuth redirect target for the Slack workspace install. Slack hits this
 * with `?code=...&state=...` (success) or `?error=access_denied` (cancel).
 *
 * Success path:
 *   1. Validate single-use state → recover the LobeHub user who initiated
 *   2. Exchange the code for a bot token via `oauth.v2.access`
 *   3. Resolve the tenant id (workspace install: `team.id`; Enterprise Grid
 *      org install: `enterprise.id`) and metadata
 *   4. Encrypt + upsert into `messenger_installations`
 *   5. 302 to `slack.com/app/open?team=<...>&id=<...>` so the user lands in
 *      the Slack desktop client ready to chat. Manus's exact handoff.
 */
export const GET = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    log('callback: user denied or Slack error: %s', errorParam);
    return redirectToSettings(url.origin, `slack_error=${encodeURIComponent(errorParam)}`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    log('callback: missing code or state');
    return redirectToSettings(url.origin, 'slack_error=missing_code_or_state');
  }

  const config = await getMessengerSlackConfig();
  if (!config) {
    log('callback: Slack messenger env not configured');
    return new Response('Slack messenger is not configured on this LobeHub deployment.', {
      status: 503,
    });
  }

  if (!appEnv.APP_URL) {
    return new Response('APP_URL is not configured', { status: 503 });
  }

  // 1. State validation — single-use; gone after this call.
  const statePayload = await consumeOAuthState(state);
  if (!statePayload) {
    log('callback: invalid or expired state');
    return redirectToSettings(url.origin, 'slack_error=invalid_state');
  }

  // 2. Exchange the code. Use the SAME redirect_uri we generated at install
  // time — Slack rejects the exchange otherwise.
  const redirectUri = `${appEnv.APP_URL.replace(/\/$/, '')}/api/agent/messenger/slack/oauth/callback`;
  let oauth;
  try {
    oauth = await exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
    });
  } catch (error) {
    log('callback: oauth.v2.access failed: %O', error);
    return redirectToSettings(url.origin, 'slack_error=exchange_failed');
  }

  // 3. Resolve tenant_id + metadata. Workspace install → team.id; Enterprise
  // Grid org install → enterprise.id (and metadata.isEnterpriseInstall).
  const isEnterpriseInstall = oauth.is_enterprise_install === true;
  const tenantId = isEnterpriseInstall ? oauth.enterprise?.id : oauth.team?.id;
  const tenantName = isEnterpriseInstall ? oauth.enterprise?.name : oauth.team?.name;

  if (!tenantId) {
    log('callback: oauth response missing team.id / enterprise.id');
    return redirectToSettings(url.origin, 'slack_error=missing_tenant');
  }

  if (!oauth.access_token) {
    log('callback: oauth response missing access_token');
    return redirectToSettings(url.origin, 'slack_error=missing_token');
  }

  if (!oauth.app_id) {
    log('callback: oauth response missing app_id');
    return redirectToSettings(url.origin, 'slack_error=missing_app_id');
  }

  // 4. Detect takeover by another LobeHub user. The workspace install is
  // shared infrastructure: whoever connected first owns the row. Slack's
  // OAuth doesn't let us refuse the install (the token has already been
  // minted by the time we get here), and `auth.revoke` on a bot token would
  // uninstall the entire app from the workspace — destructive — so instead
  // we **refresh the credentials** (Slack may have rotated the bot token as
  // part of the re-install) but **preserve the original owner**. The new
  // user is told the workspace is already connected and routed to DM the
  // bot for personal-account linking.
  //
  // Re-installs by the SAME user (token refresh / scope bump) and takeovers
  // after the previous owner was deleted (`installed_by_user_id IS NULL`)
  // or the install was revoked (`revoked_at IS NOT NULL`) take normal
  // ownership.
  const serverDB = await getServerDB();
  const existing = await MessengerInstallationModel.findByTenant(
    serverDB,
    'slack',
    tenantId,
    oauth.app_id,
  );
  const isTakeoverAttempt =
    !!existing &&
    !!existing.installedByUserId &&
    existing.installedByUserId !== statePayload.lobeUserId;

  // 5. Encrypt + upsert. Token rotation is opt-in per App; presence of
  // `expires_in` + `refresh_token` is what tells us this install is rotating.
  const credentials: Record<string, unknown> = { botToken: oauth.access_token };
  if (oauth.refresh_token) credentials.refreshToken = oauth.refresh_token;

  const tokenExpiresAt =
    typeof oauth.expires_in === 'number' ? new Date(Date.now() + oauth.expires_in * 1000) : null;

  const metadata: Record<string, unknown> = {
    enterpriseId: oauth.enterprise?.id ?? null,
    isEnterpriseInstall,
    scope: oauth.scope ?? '',
    tenantName: tenantName ?? '',
  };

  let gateKeeper: KeyVaultsGateKeeper | undefined;
  try {
    gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  } catch (error) {
    log('callback: KeyVaultsGateKeeper init failed (KEY_VAULTS_SECRET unset?): %O', error);
    return new Response(
      'Server is missing KEY_VAULTS_SECRET — Slack install token cannot be encrypted.',
      { status: 503 },
    );
  }

  try {
    await MessengerInstallationModel.upsert(
      serverDB,
      {
        accountId: oauth.bot_user_id ?? null,
        applicationId: oauth.app_id,
        credentials,
        installedByPlatformUserId: isTakeoverAttempt
          ? existing!.installedByPlatformUserId
          : (oauth.authed_user?.id ?? null),
        installedByUserId: isTakeoverAttempt
          ? existing!.installedByUserId
          : statePayload.lobeUserId,
        metadata,
        platform: 'slack',
        tenantId,
        tokenExpiresAt,
      },
      gateKeeper,
    );
  } catch (error) {
    log('callback: failed to persist installation row: %O', error);
    return redirectToSettings(url.origin, 'slack_error=persist_failed');
  }

  // 6. Branch on outcome. Takeover attempts get bounced to settings with a
  // dedicated error so the page can render a Modal explaining the situation
  // (`tenant_name` lets the UI name the workspace).
  if (isTakeoverAttempt) {
    log(
      'callback: refreshed credentials for tenant=%s but preserved owner=%s (blocked takeover by user=%s)',
      tenantId,
      existing!.installedByUserId,
      statePayload.lobeUserId,
    );
    const params = new URLSearchParams({ slack_error: 'already_installed' });
    if (tenantName) params.set('slack_workspace', tenantName);
    return redirectToSettings(url.origin, params.toString());
  }

  // 7. Hand the user off to the Slack client (Manus pattern). Workspace
  // installs use `team=<team_id>`; Enterprise Grid installs don't have a
  // single team to deep-link to, so we fall back to the settings page.
  if (isEnterpriseInstall) {
    return redirectToSettings(url.origin, 'slack_installed=enterprise');
  }

  const openUrl = new URL('https://slack.com/app/open');
  openUrl.searchParams.set('team', tenantId);
  openUrl.searchParams.set('id', oauth.app_id);
  log('callback: install complete for tenant=%s, redirecting to slack.com/app/open', tenantId);
  return Response.redirect(openUrl, 302);
};
