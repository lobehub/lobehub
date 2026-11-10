import debug from 'debug';
import type { Context } from 'hono';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { LinearConnectionModel } from '@/database/models/linear';
import { linearEnv } from '@/envs/linear';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  exchangeLinearCode,
  fetchLinearViewer,
  revokeLinearToken,
} from '@/server/services/linear/client';
import { redisService } from '@/server/services/redis';
import { canWriteScmScope, sanitizeReturnTo } from '@/server/services/scm/scope';

const log = debug('lobe-server:linear:callback');

/** Where the user lands after connecting; the page reads `installed=…` or `error=…`. */
export const LINEAR_SETTINGS_PATH = '/settings/integrations/linear';

const redirectToSettings = (origin: string, params: Record<string, string>, returnTo?: string) => {
  const target = new URL(sanitizeReturnTo(returnTo) ?? LINEAR_SETTINGS_PATH, origin);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return Response.redirect(target, 302);
};

/**
 * Linear sends the user here after the consent screen. Only a callback that
 * carries our state is honored: the state names the user and scope, so the
 * code is never exchanged for a session we did not start. The browser must
 * also be signed in as that user — otherwise an authorization URL started by
 * one account and forwarded to another would file the clicker's Linear
 * workspace under the sender.
 */
export const linearCallback = async (c: Context): Promise<Response> => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  if (!linearEnv.ENABLED_LINEAR) {
    return new Response('Linear is not configured on this LobeHub deployment.', { status: 503 });
  }

  const statePayload = state ? await redisService.linear.consumeOAuthState(state) : null;
  if (!statePayload) return redirectToSettings(url.origin, { error: 'invalid_state' });

  const { lobeUserId: userId, returnTo } = statePayload;
  const workspaceId = statePayload.workspaceId ?? null;

  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch((error) => {
    log('getSession failed: %O', error);
    return null;
  });
  if (session?.user?.id !== userId) {
    log('state for user=%s finished by another session', userId);
    return redirectToSettings(url.origin, { error: 'invalid_state' });
  }

  // The user declined on Linear's consent screen.
  if (providerError) return redirectToSettings(url.origin, { error: 'access_denied' }, returnTo);
  if (!code) return redirectToSettings(url.origin, { error: 'missing_code' }, returnTo);

  const db = await getServerDB();
  // Membership can change between the click and the callback; recheck.
  if (!(await canWriteScmScope(db, userId, workspaceId))) {
    return redirectToSettings(url.origin, { error: 'workspace_forbidden' }, returnTo);
  }

  let tokens: Awaited<ReturnType<typeof exchangeLinearCode>>;
  try {
    tokens = await exchangeLinearCode(code);
  } catch (error) {
    log('code exchange failed: %O', error);
    return redirectToSettings(url.origin, { error: 'exchange_failed' }, returnTo);
  }

  // From here on Linear has issued a token; any failure hands it back.
  const abandon = async (error: string) => {
    await revokeLinearToken(tokens, tokens.expiresAt);
    return redirectToSettings(url.origin, { error }, returnTo);
  };

  let viewer: Awaited<ReturnType<typeof fetchLinearViewer>>;
  try {
    viewer = await fetchLinearViewer(tokens.accessToken);
  } catch (error) {
    log('viewer lookup failed: %O', error);
    return abandon('exchange_failed');
  }

  try {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    await LinearConnectionModel.upsert(
      db,
      {
        actorExternalId: viewer.id,
        actorName: viewer.name,
        credentials: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
        metadata: {
          actorAvatarUrl: viewer.avatarUrl ?? undefined,
          organizationLogoUrl: viewer.organization.logoUrl ?? undefined,
          scopes: tokens.scopes,
        },
        organizationId: viewer.organization.id,
        organizationName: viewer.organization.name,
        organizationUrlKey: viewer.organization.urlKey,
        tokenExpiresAt: tokens.expiresAt ?? null,
        userId,
        workspaceId,
      },
      gateKeeper,
    );
  } catch (error) {
    log('cannot store connection: %O', error);
    return abandon('save_failed');
  }

  log('connected organization %s for user=%s', viewer.organization.urlKey, userId);
  return redirectToSettings(
    url.origin,
    { account: viewer.organization.name, installed: 'ok' },
    returnTo,
  );
};
