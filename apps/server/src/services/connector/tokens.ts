import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import debug from 'debug';
import pMap from 'p-map';

import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { ConnectorCredentials } from '@/database/schemas';

import { refreshConnectorToken, toClientInformation } from './oauth';

const log = debug('lobe-server:connector:tokens');

/** Refresh slightly before actual expiry to avoid races on the boundary. */
const EXPIRY_SKEW_MS = 60_000;

/** Map an OAuth token response into the persisted credential + expiry shape. */
export const tokensToCredentials = (
  tokens: OAuthTokens,
  opts: { clientSecret?: string; fallbackRefreshToken?: string } = {},
): { credentials: ConnectorCredentials; tokenExpiresAt: Date | null } => {
  const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
  return {
    credentials: {
      accessToken: tokens.access_token,
      clientSecret: opts.clientSecret,
      expiresAt,
      // Refresh tokens may rotate; keep the previous one when the AS omits it.
      refreshToken: tokens.refresh_token ?? opts.fallbackRefreshToken,
      scope: tokens.scope,
      type: 'oauth2',
    },
    tokenExpiresAt: expiresAt ? new Date(expiresAt) : null,
  };
};

/** Whether the connector holds a refreshable OAuth token that is expired or about to expire. */
const isRefreshDue = (connector: DecryptedConnector): boolean => {
  const creds = connector.credentials;
  if (!creds || creds.type !== 'oauth2' || !creds.refreshToken) return false;
  return !creds.expiresAt || creds.expiresAt - EXPIRY_SKEW_MS <= Date.now();
};

const hasKnownExpiry = (connector: DecryptedConnector): boolean =>
  connector.credentials?.type === 'oauth2' && !!connector.credentials.expiresAt;

/**
 * Lazily refresh a connector's OAuth access token when it is expired (or about
 * to expire). Persists the rotated credentials and returns the connector with
 * fresh credentials in memory. No-op for non-oauth2 connectors or when the
 * token is still valid / not refreshable.
 */
export const ensureFreshConnectorToken = async (
  connector: DecryptedConnector,
  connectorModel: ConnectorModel,
): Promise<DecryptedConnector> => {
  const creds = connector.credentials;
  const oidc = connector.oidcConfig;

  if (!creds || creds.type !== 'oauth2' || !creds.refreshToken || !isRefreshDue(connector)) {
    return connector;
  }
  if (!oidc?.issuer || !oidc.clientId) return connector;

  try {
    const metadata = await discoverAuthorizationServerMetadata(oidc.issuer);
    if (!metadata) return connector;

    const { authMethod, tokens } = await refreshConnectorToken({
      authorizationServerUrl: oidc.issuer,
      clientInformation: toClientInformation(oidc),
      metadata,
      refreshToken: creds.refreshToken,
      resource: connector.mcpServerUrl ?? undefined,
    });

    const { credentials, tokenExpiresAt } = tokensToCredentials(tokens, {
      clientSecret: oidc.clientSecret,
      fallbackRefreshToken: creds.refreshToken,
    });

    await connectorModel.update(connector.id, {
      credentials: JSON.stringify(credentials),
      ...(authMethod && { oidcConfig: { ...oidc, tokenEndpointAuthMethod: authMethod } }),
      tokenExpiresAt,
    });

    return { ...connector, credentials };
  } catch {
    log('token refresh failed for connector=%s', connector.id);
    return reloadIfRotatedElsewhere(connector, connectorModel);
  }
};

/**
 * How long a failed refresh waits for a concurrent winner to persist the
 * rotated token before re-reading once more.
 */
const ROTATION_PERSIST_GRACE_MS = 1000;

const readRotatedCredentials = async (
  connector: DecryptedConnector,
  connectorModel: ConnectorModel,
): Promise<DecryptedConnector | undefined> => {
  const staleCreds = connector.credentials;
  const latestCreds = (await connectorModel.findById(connector.id))?.credentials;
  if (
    latestCreds?.type === 'oauth2' &&
    staleCreds?.type === 'oauth2' &&
    latestCreds.accessToken !== staleCreds.accessToken &&
    // Servers may omit `expires_in`, so a rotated token can lack an expiry.
    (!latestCreds.expiresAt || latestCreds.expiresAt - EXPIRY_SKEW_MS > Date.now())
  ) {
    return { ...connector, credentials: latestCreds };
  }
};

/**
 * A rotating authorization server invalidates a refresh token once it is used,
 * so when two runs refresh the same connector concurrently the loser fails
 * with credentials the winner already replaced. Re-read the row — once more
 * after a short grace, since the winner may still be persisting — and use the
 * winner's token instead of failing the run with a stale one.
 */
const reloadIfRotatedElsewhere = async (
  connector: DecryptedConnector,
  connectorModel: ConnectorModel,
): Promise<DecryptedConnector> => {
  try {
    const rotated = await readRotatedCredentials(connector, connectorModel);
    if (rotated) return rotated;

    await new Promise((resolve) => setTimeout(resolve, ROTATION_PERSIST_GRACE_MS));
    return (await readRotatedCredentials(connector, connectorModel)) ?? connector;
  } catch {
    log('reloading connector=%s after a failed refresh failed', connector.id);
    return connector;
  }
};

/**
 * Upper bound a run waits on one authorization server. On timeout the run
 * keeps the stored credentials; the refresh still finishes and persists.
 */
const RUN_TOKEN_REFRESH_TIMEOUT_MS = 5000;

/**
 * Concurrent authorization-server calls per run. Runs rarely hold more due
 * OAuth connectors than this, so the common case still finishes in one wave.
 */
const RUN_TOKEN_REFRESH_CONCURRENCY = 5;

/**
 * Refreshes in flight on this instance, keyed by connector id, so concurrent
 * runs of one shared agent spend the refresh token once instead of racing.
 */
const inFlightRefreshes = new Map<string, Promise<DecryptedConnector>>();

const refreshOnce = (
  connector: DecryptedConnector,
  connectorModel: ConnectorModel,
): Promise<DecryptedConnector> => {
  const pending = inFlightRefreshes.get(connector.id);
  if (pending) return pending;

  const refresh = ensureFreshConnectorToken(connector, connectorModel).finally(() => {
    if (inFlightRefreshes.get(connector.id) === refresh) inFlightRefreshes.delete(connector.id);
  });
  inFlightRefreshes.set(connector.id, refresh);
  return refresh;
};

/**
 * Refresh expired OAuth tokens before an agent run bakes connector credentials
 * into its tool manifests. Without this the runtime only refreshed through the
 * background tool sync scheduled after the run started, so the first call after
 * every access-token expiry 401'd even when the refresh token was still valid —
 * and the model then reported a connection that only needed a refresh as one
 * the owner must reconnect (LOBE-14771).
 *
 * `connectorModel` must carry the gatekeeper so rotated credentials are
 * persisted encrypted. Never throws; a connector that cannot be refreshed is
 * returned unchanged, and `onTimeout` reports each one that hit the time limit.
 */
export const refreshExpiredConnectorTokens = (
  connectors: DecryptedConnector[],
  connectorModel: ConnectorModel,
  options: { onTimeout?: () => void } = {},
): Promise<DecryptedConnector[]> =>
  pMap(
    connectors,
    async (connector) => {
      // Disabled connectors never reach the manifests, so refreshing them only
      // delays the run and rotates credentials nobody uses. A token without a
      // known expiry (the server omitted `expires_in`) is not known to be
      // stale; refreshing it here would rotate it on every chat.
      if (!connector.isEnabled || !hasKnownExpiry(connector) || !isRefreshDue(connector)) {
        return connector;
      }

      const refresh = refreshOnce(connector, connectorModel);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<DecryptedConnector>((resolve) => {
        timer = setTimeout(() => {
          log('token refresh timed out for connector=%s', connector.id);
          // A refresh that never settles would otherwise stay shared forever,
          // making every later run wait on it instead of retrying.
          if (inFlightRefreshes.get(connector.id) === refresh) {
            inFlightRefreshes.delete(connector.id);
          }
          options.onTimeout?.();
          resolve(connector);
        }, RUN_TOKEN_REFRESH_TIMEOUT_MS);
      });
      try {
        return await Promise.race([refresh, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    { concurrency: RUN_TOKEN_REFRESH_CONCURRENCY },
  );
