import debug from 'debug';
import type { Context } from 'hono';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { ScmIdentityModel, ScmInstallationModel } from '@/database/models/scm';
import { scmEnv } from '@/envs/scm';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { exchangeGitHubUserCode, fetchGitHubInstallation } from '@/server/services/scm/github/app';
import { consumeScmInstallState } from '@/server/services/scm/oauth/stateStore';

const log = debug('lobe-server:scm:github-setup');

/** Where the user lands after connecting; the page reads `scm=github&installed=ok|error=…`. */
const SETTINGS_PATH = '/settings';

const redirectToSettings = (origin: string, params: Record<string, string>, returnTo?: string) => {
  const target = new URL(returnTo ?? SETTINGS_PATH, origin);
  target.searchParams.set('scm', 'github');
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return Response.redirect(target, 302);
};

/**
 * GitHub sends the user here after installing (Callback URL, with `code`)
 * and after changing an installation's repositories (Setup URL, without
 * `code`). One handler covers both:
 *
 * - With `code`: exchange it for the user's identity, read the installation
 *   from the API, bind it to the LobeHub user recovered from `state` (or the
 *   current session when the install started on github.com), redirect.
 * - Without `code`: refresh the installation snapshot; the row must exist.
 *
 * The App must have "Request user authorization (OAuth) during installation"
 * enabled for the `code` leg to exist.
 */
export const githubSetup = async (c: Context): Promise<Response> => {
  const url = new URL(c.req.url);
  const installationId = url.searchParams.get('installation_id');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const setupAction = url.searchParams.get('setup_action');

  if (!scmEnv.ENABLED_GITHUB_APP) {
    return new Response('GitHub App is not configured on this LobeHub deployment.', {
      status: 503,
    });
  }
  if (!installationId) {
    return redirectToSettings(url.origin, { error: 'missing_installation' });
  }

  const db = await getServerDB();

  // 1. Who is connecting: the state issued by our install entry, else the session.
  const statePayload = state ? await consumeScmInstallState(state) : null;
  let userId = statePayload?.lobeUserId;
  if (!userId) {
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      userId = session?.user?.id;
    } catch (error) {
      log('getSession failed: %O', error);
    }
  }
  if (!userId) {
    // Started on github.com without a LobeHub session: bounce through sign-in
    // and come back with the same query so the code can still be exchanged.
    const callbackUrl = encodeURIComponent(`${url.pathname}${url.search}`);
    return Response.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, url.origin), 302);
  }
  const returnTo = statePayload?.returnTo;

  // 2. Refresh-only leg (Setup URL after a repository change).
  if (!code) {
    const existing = await ScmInstallationModel.findByProviderInstallationId(
      db,
      'github',
      installationId,
    );
    if (!existing)
      return redirectToSettings(url.origin, { error: 'unknown_installation' }, returnTo);

    try {
      const snapshot = await fetchGitHubInstallation(installationId);
      await ScmInstallationModel.refreshSnapshot(db, existing.id, snapshot);
    } catch (error) {
      log('refresh %s failed: %O', installationId, error);
      return redirectToSettings(url.origin, { error: 'refresh_failed' }, returnTo);
    }
    return redirectToSettings(url.origin, { installed: 'updated' }, returnTo);
  }

  // 3. Install leg: identity first, then the installation bound to the user.
  let authorization: Awaited<ReturnType<typeof exchangeGitHubUserCode>>;
  try {
    authorization = await exchangeGitHubUserCode(code);
  } catch (error) {
    log('code exchange failed: %O', error);
    return redirectToSettings(url.origin, { error: 'exchange_failed' }, returnTo);
  }

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  try {
    await ScmIdentityModel.upsert(
      db,
      {
        credentials: {
          accessToken: authorization.accessToken,
          refreshToken: authorization.refreshToken,
          refreshTokenExpiresAt: authorization.refreshTokenExpiresAt,
        },
        externalLogin: authorization.user.login,
        externalUserId: authorization.user.externalId,
        metadata: {
          avatarUrl: authorization.user.avatarUrl,
          email: authorization.user.email ?? undefined,
        },
        provider: 'github',
        tokenExpiresAt: authorization.expiresAt ? new Date(authorization.expiresAt) : null,
        userId,
      },
      gateKeeper,
    );
  } catch (error) {
    // The unique index on (provider, external_user_id) fires when this GitHub
    // account is already someone else's identity.
    log('identity upsert failed for %s: %O', authorization.user.login, error);
    return redirectToSettings(url.origin, { error: 'identity_taken' }, returnTo);
  }

  let snapshot: Awaited<ReturnType<typeof fetchGitHubInstallation>>;
  try {
    snapshot = await fetchGitHubInstallation(installationId);
  } catch (error) {
    log('fetch installation %s failed: %O', installationId, error);
    return redirectToSettings(url.origin, { error: 'installation_fetch_failed' }, returnTo);
  }

  const installation = await ScmInstallationModel.bind(db, {
    ...snapshot,
    installedByExternalLogin: authorization.user.login,
    installedByExternalUserId: authorization.user.externalId,
    userId,
    workspaceId: statePayload?.workspaceId ?? null,
  });

  log(
    'bound installation %s (%s) to user=%s workspace=%s action=%s',
    installation.id,
    snapshot.accountLogin,
    userId,
    statePayload?.workspaceId ?? '-',
    setupAction ?? '-',
  );
  return redirectToSettings(
    url.origin,
    { account: snapshot.accountLogin, installed: 'ok' },
    returnTo,
  );
};
