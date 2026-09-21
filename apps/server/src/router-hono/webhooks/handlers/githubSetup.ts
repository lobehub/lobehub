import debug from 'debug';
import type { Context } from 'hono';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { ScmIdentityModel, ScmInstallationModel } from '@/database/models/scm';
import { scmEnv } from '@/envs/scm';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  exchangeGitHubUserCode,
  fetchGitHubInstallation,
  userCanAccessInstallation,
} from '@/server/services/scm/github/app';
import {
  consumeScmInstallState,
  issueScmInstallClaim,
} from '@/server/services/scm/oauth/stateStore';
import { canWriteScmScope, sanitizeReturnTo } from '@/server/services/scm/scope';

const log = debug('lobe-server:scm:github-setup');

/**
 * Where the user lands after connecting; the page reads `installed=…`,
 * `error=…` or `pending=…` from the query.
 *
 * That page ships with the settings half of this stack. Until it lands the
 * path renders the bare settings shell — which no user reaches, because the
 * install entry is only linked from that same page and the App stays
 * disabled without its environment variables.
 */
const SETTINGS_PATH = '/settings/integrations/github';

const redirectToSettings = (origin: string, params: Record<string, string>, returnTo?: string) => {
  const target = new URL(sanitizeReturnTo(returnTo) ?? SETTINGS_PATH, origin);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return Response.redirect(target, 302);
};

/**
 * GitHub sends the user here after installing (Callback URL, with `code`)
 * and after changing an installation's repositories (Setup URL, without
 * `code`). One handler covers both:
 *
 * - **With our `state`** (the flow started from "Connect" in LobeHub): the
 *   state names the user and scope; the code, when present, is exchanged
 *   for the user's identity and the installation is bound.
 * - **Without `state`** (the flow started on github.com, or the state
 *   expired): nothing is bound automatically. A known installation owned by
 *   the session user is refreshed; anything else is handed to the settings
 *   page as a single-use claim, which the user redeems from a signed-in
 *   request to finish the connection. The `code` is never exchanged here: a
 *   stateless callback could be an attacker's authorization URL forwarded to
 *   a signed-in victim, and linking that identity would hand the victim's
 *   account to the attacker.
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
  const statePayload = state ? await consumeScmInstallState(state) : null;

  // ---- Stateless leg: refresh what the user already owns, confirm the rest.
  if (!statePayload) {
    let userId: string | undefined;
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      userId = session?.user?.id;
    } catch (error) {
      log('getSession failed: %O', error);
    }
    if (!userId) {
      // Bounce through sign-in and come back with the same query.
      const callbackUrl = encodeURIComponent(`${url.pathname}${url.search}`);
      return Response.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, url.origin), 302);
    }

    let snapshot: Awaited<ReturnType<typeof fetchGitHubInstallation>>;
    try {
      snapshot = await fetchGitHubInstallation(installationId);
    } catch (error) {
      log('fetch installation %s failed: %O', installationId, error);
      return redirectToSettings(url.origin, { error: 'installation_fetch_failed' });
    }

    const existing = await ScmInstallationModel.findByProviderInstallationId(
      db,
      'github',
      installationId,
    );
    if (
      existing &&
      (existing.workspaceId
        ? await canWriteScmScope(db, userId, existing.workspaceId)
        : existing.userId === userId)
    ) {
      await ScmInstallationModel.refreshSnapshot(db, existing.id, snapshot);
      return redirectToSettings(url.origin, { installed: 'updated' });
    }

    // The confirmation carries a claim, not the raw id: redeeming it is the
    // proof that this user came back from GitHub holding this installation.
    const claim = await issueScmInstallClaim({
      installationId,
      lobeUserId: userId,
      provider: 'github',
    });
    if (!claim) return redirectToSettings(url.origin, { error: 'claim_unavailable' });

    log(
      'installation %s (%s) arrived without state for user=%s; asking for confirmation',
      installationId,
      snapshot.accountLogin,
      userId,
    );
    return redirectToSettings(url.origin, { account: snapshot.accountLogin, pending: claim });
  }

  // ---- Stateful leg: the user and scope come from the state we issued.
  const userId = statePayload.lobeUserId;
  const workspaceId = statePayload.workspaceId ?? null;
  const returnTo = statePayload.returnTo;

  // Membership can change between the click and the callback; recheck.
  if (!(await canWriteScmScope(db, userId, workspaceId))) {
    return redirectToSettings(url.origin, { error: 'workspace_forbidden' }, returnTo);
  }

  let installedBy: { login: string; userId: string } | undefined;
  // Identity linking is its own capability: without OAuth credentials the
  // exchange can only fail, so bind the installation and skip it.
  if (code && !scmEnv.ENABLED_GITHUB_APP_OAUTH) {
    log('skipping identity link for installation %s: OAuth is not configured', installationId);
  } else if (code) {
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
    // App-level access proves the installation belongs to this App, not that
    // the person finishing the flow has anything to do with it. Without this
    // check a valid state of one's own plus a guessed installation id would
    // move someone else's installation into the attacker's scope.
    if (!(await userCanAccessInstallation(authorization.accessToken, installationId))) {
      log(
        'user %s cannot access installation %s; refusing to bind',
        authorization.user.login,
        installationId,
      );
      return redirectToSettings(url.origin, { error: 'installation_not_yours' }, returnTo);
    }

    installedBy = { login: authorization.user.login, userId: authorization.user.externalId };
  }

  let snapshot: Awaited<ReturnType<typeof fetchGitHubInstallation>>;
  try {
    snapshot = await fetchGitHubInstallation(installationId);
  } catch (error) {
    log('fetch installation %s failed: %O', installationId, error);
    return redirectToSettings(url.origin, { error: 'installation_fetch_failed' }, returnTo);
  }

  // Binding moves the row's scope, so an installation that already belongs
  // to someone else is never taken over from here — whoever holds it has to
  // disconnect it first. (With a code we have already proved access, but the
  // owner still decides.)
  const bound = await ScmInstallationModel.findByProviderInstallationId(
    db,
    'github',
    installationId,
  );
  const ownedByCaller =
    !bound ||
    !!bound.revokedAt ||
    (bound.userId === userId && (bound.workspaceId ?? null) === workspaceId);
  if (!ownedByCaller) {
    log('installation %s is connected elsewhere; refusing to rebind', installationId);
    return redirectToSettings(url.origin, { error: 'installation_taken' }, returnTo);
  }

  const installation = await ScmInstallationModel.bind(db, {
    ...snapshot,
    installedByExternalLogin: installedBy?.login,
    installedByExternalUserId: installedBy?.userId,
    userId,
    workspaceId,
  });

  log(
    'bound installation %s (%s) to user=%s workspace=%s action=%s identity=%s',
    installation.id,
    snapshot.accountLogin,
    userId,
    workspaceId ?? '-',
    setupAction ?? '-',
    installedBy ? 'linked' : 'none',
  );
  return redirectToSettings(
    url.origin,
    { account: snapshot.accountLogin, installed: 'ok' },
    returnTo,
  );
};
