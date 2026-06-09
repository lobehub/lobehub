import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import debug from 'debug';

import type { ConnectorModel, DecryptedConnector } from '@/database/models/connector';
import type { ConnectorCredentials } from '@/database/schemas';

import { refreshConnectorToken } from './oauth';

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

  if (!creds || creds.type !== 'oauth2' || !creds.refreshToken) return connector;
  if (creds.expiresAt && creds.expiresAt - EXPIRY_SKEW_MS > Date.now()) return connector;
  if (!oidc?.issuer || !oidc.clientId) return connector;

  try {
    const metadata = await discoverAuthorizationServerMetadata(oidc.issuer);
    if (!metadata) return connector;

    const tokens = await refreshConnectorToken({
      authorizationServerUrl: oidc.issuer,
      clientInformation: { client_id: oidc.clientId, client_secret: oidc.clientSecret },
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
      tokenExpiresAt,
    });

    return { ...connector, credentials };
  } catch (err) {
    log('token refresh failed for connector=%s: %O', connector.id, err);
    return connector;
  }
};
