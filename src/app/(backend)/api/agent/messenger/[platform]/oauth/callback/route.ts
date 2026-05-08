import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { appEnv } from '@/envs/app';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { consumeOAuthState } from '@/server/services/messenger/oauth/stateStore';
import { messengerPlatformRegistry } from '@/server/services/messenger/platforms';

const log = debug('lobe-server:messenger:oauth-callback');

const SETTINGS_PATH = '/settings/messenger';

// All OAuth callbacks land on the per-platform detail page so the user sees the
// freshly-installed workspace/server without an extra click. The detail page
// reads `installed=ok` / `error=...` / `workspace=...` from the URL.
const redirectToPlatform = (origin: string, platform: string, query?: string): Response => {
  const target = new URL(`${SETTINGS_PATH}/${platform}${query ? `?${query}` : ''}`, origin);
  return Response.redirect(target, 302);
};

const errorRedirect = (origin: string, platform: string, code: string, extra?: URLSearchParams) => {
  const params = new URLSearchParams(extra);
  params.set('error', code);
  return redirectToPlatform(origin, platform, params.toString());
};

/**
 * Generic OAuth redirect target for the per-tenant install flow. The upstream
 * (Slack / Discord / …) hits this with `?code=...&state=...` (success) or
 * `?error=access_denied` (cancel). Platform-specific concerns — token
 * exchange, response shape, deep-link target — live behind the platform's
 * `oauth` adapter at `platforms/<id>/oauth.ts`.
 *
 * Success path:
 *   1. Validate single-use state → recover the LobeHub user who initiated
 *   2. Exchange the code via the platform adapter, normalised into
 *      `NormalizedInstallation`
 *   3. Detect tenant takeover (another LobeHub user already owns this row)
 *   4. Encrypt + upsert into `messenger_installations`
 *   5. Hand off to the platform's deep-link redirect (Slack
 *      `slack.com/app/open`) or fall back to the settings page.
 */
export const GET = async (
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
): Promise<Response> => {
  const { platform } = await params;
  const url = new URL(req.url);

  const definition = messengerPlatformRegistry.getPlatform(platform);
  if (!definition?.oauth) {
    log('callback: platform %s has no OAuth adapter', platform);
    return new Response(`Messenger platform "${platform}" does not support OAuth install.`, {
      status: 404,
    });
  }

  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    log('callback[%s]: user denied or upstream error: %s', platform, errorParam);
    return errorRedirect(url.origin, platform, errorParam);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    log('callback[%s]: missing code or state', platform);
    return errorRedirect(url.origin, platform, 'missing_code_or_state');
  }

  const config = await definition.oauth.getAppConfig();
  if (!config) {
    log('callback[%s]: messenger env not configured', platform);
    return new Response(
      `${definition.name} messenger is not configured on this LobeHub deployment.`,
      { status: 503 },
    );
  }

  if (!appEnv.APP_URL) {
    return new Response('APP_URL is not configured', { status: 503 });
  }

  // 1. State validation — single-use; gone after this call.
  const statePayload = await consumeOAuthState(state);
  if (!statePayload) {
    log('callback[%s]: invalid or expired state', platform);
    return errorRedirect(url.origin, platform, 'invalid_state');
  }

  // 2. Exchange via platform adapter. Use the SAME redirect_uri we generated
  // at install time — most upstreams reject the exchange otherwise.
  const redirectUri = `${appEnv.APP_URL.replace(/\/$/, '')}/api/agent/messenger/${platform}/oauth/callback`;
  let install;
  try {
    install = await definition.oauth.exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
    });
  } catch (error) {
    log('callback[%s]: exchangeCode failed: %O', platform, error);
    return errorRedirect(url.origin, platform, 'exchange_failed');
  }

  // 3. Detect takeover by another LobeHub user. The tenant install is shared
  // infrastructure: whoever connected first owns the row. OAuth doesn't let
  // us refuse the install (the token has already been minted by the time we
  // get here), and revoking would uninstall the App from the tenant —
  // destructive — so instead we **refresh the credentials** (the upstream
  // may have rotated tokens as part of the re-install) but **preserve the
  // original owner**. The new user is told the tenant is already connected
  // and routed to DM the bot for personal-account linking.
  //
  // Re-installs by the SAME user (token refresh / scope bump) and takeovers
  // after the previous owner was deleted (`installed_by_user_id IS NULL`)
  // or the install was revoked (`revoked_at IS NOT NULL`) take normal
  // ownership.
  const serverDB = await getServerDB();
  const existing = await MessengerInstallationModel.findByTenant(
    serverDB,
    platform,
    install.tenantId,
    install.applicationId,
  );
  const isTakeoverAttempt =
    !!existing &&
    !!existing.installedByUserId &&
    existing.installedByUserId !== statePayload.lobeUserId;

  // 4. Encrypt + upsert.
  let gateKeeper: KeyVaultsGateKeeper | undefined;
  try {
    gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  } catch (error) {
    log(
      'callback[%s]: KeyVaultsGateKeeper init failed (KEY_VAULTS_SECRET unset?): %O',
      platform,
      error,
    );
    return new Response(
      `Server is missing KEY_VAULTS_SECRET — ${definition.name} install token cannot be encrypted.`,
      { status: 503 },
    );
  }

  try {
    await MessengerInstallationModel.upsert(
      serverDB,
      {
        accountId: install.accountId,
        applicationId: install.applicationId,
        credentials: install.credentials,
        installedByPlatformUserId: isTakeoverAttempt
          ? existing!.installedByPlatformUserId
          : install.installedByPlatformUserId,
        installedByUserId: isTakeoverAttempt
          ? existing!.installedByUserId
          : statePayload.lobeUserId,
        metadata: install.metadata,
        platform,
        tenantId: install.tenantId,
        tokenExpiresAt: install.tokenExpiresAt,
      },
      gateKeeper,
    );
  } catch (error) {
    log('callback[%s]: failed to persist installation row: %O', platform, error);
    return errorRedirect(url.origin, platform, 'persist_failed');
  }

  // 5. Branch on outcome. Takeover attempts get bounced to settings with a
  // dedicated error so the page can render a Modal explaining the situation
  // (tenant name lets the UI name the workspace/guild).
  if (isTakeoverAttempt) {
    log(
      'callback[%s]: refreshed credentials for tenant=%s but preserved owner=%s (blocked takeover by user=%s)',
      platform,
      install.tenantId,
      existing!.installedByUserId,
      statePayload.lobeUserId,
    );
    const extra = new URLSearchParams();
    if (install.tenantName) extra.set('workspace', install.tenantName);
    return errorRedirect(url.origin, platform, 'already_installed', extra);
  }

  // 6. Hand off to the platform's deep-link if it provides one, otherwise
  // fall back to the settings page with a `<platform>_installed=ok` flag.
  const deepLink = definition.oauth.buildPostInstallRedirect?.(install, url.origin);
  if (deepLink) {
    log(
      'callback[%s]: install complete for tenant=%s, redirecting to %s',
      platform,
      install.tenantId,
      deepLink,
    );
    return Response.redirect(deepLink, 302);
  }

  return redirectToPlatform(url.origin, platform, 'installed=ok');
};
