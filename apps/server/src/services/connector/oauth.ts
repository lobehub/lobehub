import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  extractResourceMetadataUrl,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import debug from 'debug';

import { appEnv } from '@/envs/app';

const log = debug('lobe-server:connector:oauth');

export const CONNECTOR_OAUTH_CALLBACK_PATH = '/oauth/connector/callback';

/**
 * Fixed redirect URI for all custom-connector OAuth flows. Pre-registration
 * users must register this exact URI with their OAuth app; DCR sends it as a
 * redirect_uri at registration time.
 */
export const getConnectorRedirectUri = (): string => {
  const base = appEnv.APP_URL;
  if (!base) {
    throw new Error('APP_URL is not configured; cannot build connector OAuth redirect URI');
  }
  return new URL(CONNECTOR_OAUTH_CALLBACK_PATH, base).toString();
};

export interface DiscoveredOAuth {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata;
}

/**
 * Discover the OAuth authorization server backing a remote MCP resource.
 *
 * Standard MCP auth path:
 *   1. Probe the MCP URL → expect 401 carrying `WWW-Authenticate` with the
 *      protected-resource-metadata URL (RFC 9728).
 *   2. Fetch the protected resource metadata → pick its authorization server.
 *   3. Fetch the authorization server metadata (RFC 8414) for the endpoints.
 *
 * Falls back to the MCP server origin as the authorization server when the
 * resource does not advertise PRM (some servers co-locate the AS).
 */
export const discoverConnectorOAuth = async (mcpServerUrl: string): Promise<DiscoveredOAuth> => {
  let resourceMetadataUrl: URL | undefined;
  try {
    const res = await fetch(mcpServerUrl, {
      headers: { accept: 'application/json, text/event-stream' },
      method: 'GET',
    });
    if (res.status === 401) resourceMetadataUrl = extractResourceMetadataUrl(res);
  } catch (err) {
    log('probe request failed, falling back to well-known discovery: %O', err);
  }

  let authorizationServerUrl: string | undefined;
  try {
    const prm = await discoverOAuthProtectedResourceMetadata(mcpServerUrl, { resourceMetadataUrl });
    authorizationServerUrl = prm?.authorization_servers?.[0]?.toString();
  } catch (err) {
    log('protected-resource-metadata discovery failed: %O', err);
  }

  // Fallback: assume the authorization server lives at the MCP server origin.
  if (!authorizationServerUrl) authorizationServerUrl = new URL(mcpServerUrl).origin;

  const metadata = await discoverAuthorizationServerMetadata(authorizationServerUrl);
  if (!metadata) {
    throw new Error(`Failed to discover OAuth metadata for ${authorizationServerUrl}`);
  }

  return { authorizationServerUrl, metadata };
};

/**
 * RFC 7591 Dynamic Client Registration — used when the user did not provide a
 * client_id. Returns the issued client_id (+ optional client_secret).
 */
export const registerDynamicClient = async (params: {
  authorizationServerUrl: string;
  clientName?: string;
  metadata: AuthorizationServerMetadata;
  redirectUri: string;
  scopes?: string[];
}): Promise<OAuthClientInformationFull> => {
  return registerClient(params.authorizationServerUrl, {
    clientMetadata: {
      client_name: params.clientName ?? 'LobeHub',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [params.redirectUri],
      response_types: ['code'],
      scope: params.scopes?.join(' '),
      token_endpoint_auth_method: 'client_secret_post',
    },
    metadata: params.metadata,
    scope: params.scopes?.join(' '),
  });
};

/**
 * Build the authorization-code redirect URL (with PKCE). Returns the URL to
 * open in the popup plus the `codeVerifier` that must be stashed (server-side,
 * single-use) until the callback exchanges the code.
 */
export const buildAuthorizationUrl = async (params: {
  authorizationServerUrl: string;
  clientInformation: OAuthClientInformationMixed;
  metadata: AuthorizationServerMetadata;
  redirectUri: string;
  resource?: string;
  scopes?: string[];
  state: string;
}): Promise<{ authorizationUrl: string; codeVerifier: string }> => {
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    params.authorizationServerUrl,
    {
      clientInformation: params.clientInformation,
      metadata: params.metadata,
      redirectUrl: params.redirectUri,
      resource: params.resource ? new URL(params.resource) : undefined,
      scope: params.scopes?.join(' '),
      state: params.state,
    },
  );
  return { authorizationUrl: authorizationUrl.toString(), codeVerifier };
};

/** Exchange the authorization code for tokens (callback step). */
export const exchangeConnectorCode = async (params: {
  authorizationCode: string;
  authorizationServerUrl: string;
  clientInformation: OAuthClientInformationMixed;
  codeVerifier: string;
  metadata: AuthorizationServerMetadata;
  redirectUri: string;
  resource?: string;
}): Promise<OAuthTokens> => {
  return exchangeAuthorization(params.authorizationServerUrl, {
    authorizationCode: params.authorizationCode,
    clientInformation: params.clientInformation,
    codeVerifier: params.codeVerifier,
    metadata: params.metadata,
    redirectUri: params.redirectUri,
    resource: params.resource ? new URL(params.resource) : undefined,
  });
};

/** Refresh an expired access token using the stored refresh token. */
export const refreshConnectorToken = async (params: {
  authorizationServerUrl: string;
  clientInformation: OAuthClientInformationMixed;
  metadata: AuthorizationServerMetadata;
  refreshToken: string;
  resource?: string;
}): Promise<OAuthTokens> => {
  return refreshAuthorization(params.authorizationServerUrl, {
    clientInformation: params.clientInformation,
    metadata: params.metadata,
    refreshToken: params.refreshToken,
    resource: params.resource ? new URL(params.resource) : undefined,
  });
};
