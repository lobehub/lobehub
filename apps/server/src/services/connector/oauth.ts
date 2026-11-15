import { isIP } from 'node:net';

import { BRANDING_NAME } from '@lobechat/business-const';
import { ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import type {
  AuthorizationServerMetadata,
  FetchLike,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/client';
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  isHttpsUrl,
  IssuerMismatchError,
  OAuthError,
  OAuthErrorCode,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/client';
import debug from 'debug';

import type { OIDCConfig } from '@/database/schemas';
import { appEnv } from '@/envs/app';

const log = debug('lobe-server:connector:oauth');

export const CONNECTOR_OAUTH_CALLBACK_PATH = '/oauth/connector/callback';
export const CONNECTOR_CLIENT_METADATA_PATH = '/oauth/connector/client-metadata.json';

const appUrl = (path: string): string => {
  const base = appEnv.APP_URL;
  if (!base) {
    throw new Error('APP_URL is not configured; cannot build connector OAuth URLs');
  }
  return new URL(path, base).toString();
};

/**
 * Fixed redirect URI for all custom-connector OAuth flows. Pre-registration
 * users must register this exact URI with their OAuth app; DCR sends it as a
 * redirect_uri at registration time.
 */
export const getConnectorRedirectUri = (): string => appUrl(CONNECTOR_OAUTH_CALLBACK_PATH);

/**
 * URL of LobeHub's OAuth Client ID Metadata Document (CIMD, SEP-991). It is
 * also the client_id: authorization servers that support CIMD fetch it to
 * learn the client instead of requiring registration.
 */
export const getConnectorClientMetadataUrl = (): string => appUrl(CONNECTOR_CLIENT_METADATA_PATH);

/** The document served at {@link getConnectorClientMetadataUrl}. */
export const buildConnectorClientMetadata = (): OAuthClientMetadata & { client_id: string } => ({
  client_id: getConnectorClientMetadataUrl(),
  client_name: BRANDING_NAME,
  client_uri: appUrl('/'),
  grant_types: ['authorization_code', 'refresh_token'],
  logo_uri: appUrl('/app-icons/icon-192x192.png'),
  redirect_uris: [getConnectorRedirectUri()],
  response_types: ['code'],
  // A metadata document cannot carry a secret: CIMD clients are public PKCE clients.
  token_endpoint_auth_method: 'none',
});

/**
 * Whether an external authorization server can fetch the metadata document.
 * It must be HTTPS with a path (SEP-991); local and IP-literal hosts mean a
 * private deployment the server cannot reach, where DCR still works.
 */
const isClientMetadataUrlReachable = (url: string): boolean => {
  if (!isHttpsUrl(url)) return false;
  const host = new URL(url).hostname.replaceAll(/^\[|\]$/g, '');
  if (isIP(host)) return false;
  return !['localhost', '.localhost', '.local', '.internal'].some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix,
  );
};

/**
 * The MCP server URL and every endpoint its metadata advertises (authorization
 * server, registration and token endpoints) are chosen by whoever configured
 * the connector, so all connector OAuth requests go through the SSRF-safe
 * transport. The SDK helpers take it as `fetchFn`.
 */
const connectorFetch: FetchLike = (url, init) => ssrfSafeFetch(url.toString(), init);

/** RFC 8414 / OIDC discovery for a connector's authorization server. */
export const discoverConnectorAuthorizationServerMetadata = (
  authorizationServerUrl: string,
): Promise<AuthorizationServerMetadata | undefined> =>
  discoverAuthorizationServerMetadata(authorizationServerUrl, { fetchFn: connectorFetch });

export interface DiscoveredOAuth {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata;
  /** Resource-required scopes: challenge first, then protected resource metadata. */
  scopes?: string[];
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
  let scopes: string[] | undefined;
  try {
    const res = await connectorFetch(mcpServerUrl, {
      headers: { accept: 'application/json, text/event-stream' },
      method: 'GET',
    });
    // Only the status and `WWW-Authenticate` header matter. Release the body: a server
    // may answer this GET with an SSE stream that never ends.
    await res.body?.cancel().catch(() => {});
    if (res.status === 401) {
      const challenge = extractWWWAuthenticateParams(res);
      resourceMetadataUrl = challenge.resourceMetadataUrl;
      scopes = challenge.scope?.split(' ').filter(Boolean);
    }
  } catch (err) {
    log('probe request failed, falling back to well-known discovery: %O', err);
  }

  let authorizationServerUrl: string | undefined;
  try {
    const prm = await discoverOAuthProtectedResourceMetadata(
      mcpServerUrl,
      { resourceMetadataUrl },
      connectorFetch,
    );
    authorizationServerUrl = prm?.authorization_servers?.[0]?.toString();
    if (!scopes?.length) scopes = prm?.scopes_supported;
  } catch (err) {
    log('protected-resource-metadata discovery failed: %O', err);
  }

  // Fallback: assume the authorization server lives at the MCP server origin.
  if (!authorizationServerUrl) authorizationServerUrl = new URL('/', mcpServerUrl).href;

  let metadata: AuthorizationServerMetadata | undefined;
  try {
    metadata = await discoverConnectorAuthorizationServerMetadata(authorizationServerUrl);
  } catch (error) {
    if (IssuerMismatchError.isInstance(error)) {
      throw new Error(
        'OAuth authorization server issuer does not match its discovery URL. Check the connector authorization server configuration.',
        { cause: error },
      );
    }
    throw error;
  }
  if (!metadata) {
    throw new Error(`Failed to discover OAuth metadata for ${authorizationServerUrl}`);
  }

  return { authorizationServerUrl, metadata, ...(scopes?.length ? { scopes } : {}) };
};

/**
 * Keep configured scopes unchanged. Otherwise select resource scopes before the
 * legacy AS fallback and match the SDK's refresh-token scope augmentation.
 */
export const resolveConnectorOAuthScopes = (params: {
  discovery: DiscoveredOAuth;
  existingScopes?: string[];
}): string[] | undefined => {
  if (params.existingScopes?.length) return params.existingScopes;
  const { metadata, scopes: resourceScopes } = params.discovery;
  const selected = resourceScopes ?? metadata.scopes_supported;
  const scopes = selected?.length ? [...new Set(selected)] : undefined;
  if (
    scopes?.length &&
    metadata.scopes_supported?.includes('offline_access') &&
    buildConnectorClientMetadata().grant_types?.includes('refresh_token') &&
    !scopes.includes('offline_access')
  ) {
    scopes.push('offline_access');
  }
  return scopes;
};

type RegistrationAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none';

/**
 * Pick the `token_endpoint_auth_method` to request at registration time from
 * what the authorization server advertises. Many MCP servers only accept public
 * PKCE clients (`none`) and reject a confidential registration outright, so we
 * must not hardcode one. Metadata that omits the field keeps the confidential
 * default. Token exchange/refresh later infers the method from whether a
 * client_secret was issued.
 */
export const selectRegistrationAuthMethod = (
  metadata: AuthorizationServerMetadata,
): RegistrationAuthMethod => {
  const supported = metadata.token_endpoint_auth_methods_supported;
  if (!supported || supported.length === 0) return 'client_secret_post';

  const preferred: RegistrationAuthMethod[] = ['client_secret_post', 'client_secret_basic', 'none'];
  return preferred.find((method) => supported.includes(method)) ?? 'none';
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
      client_name: params.clientName ?? BRANDING_NAME,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: [params.redirectUri],
      response_types: ['code'],
      scope: params.scopes?.join(' '),
      token_endpoint_auth_method: selectRegistrationAuthMethod(params.metadata),
    },
    fetchFn: connectorFetch,
    metadata: params.metadata,
    scope: params.scopes?.join(' '),
  });
};

export interface ConnectorClient {
  clientId: string;
  clientSecret?: string;
  scheme: OIDCConfig['scheme'];
  tokenEndpointAuthMethod?: OIDCConfig['tokenEndpointAuthMethod'];
}

/**
 * Resolve the OAuth client for an authorization run, in the MCP client
 * registration priority: a stored client (user pre-registration or an earlier
 * DCR), then a Client ID Metadata Document when the authorization server
 * supports it, then RFC 7591 dynamic registration.
 *
 * A CIMD client_id is derived from APP_URL, so it is re-derived on every run
 * instead of being reused, and drops to DCR if the server stops supporting it.
 * Errors are configuration problems the user must fix on their side.
 */
export const resolveConnectorClient = async (params: {
  authorizationServerUrl: string;
  existing: OIDCConfig;
  metadata: AuthorizationServerMetadata;
  redirectUri: string;
  scopes?: string[];
}): Promise<ConnectorClient> => {
  const { existing, metadata } = params;
  if (existing.clientId && existing.scheme !== 'client_id_metadata_document') {
    return {
      clientId: existing.clientId,
      clientSecret: existing.clientSecret,
      scheme: existing.scheme,
      tokenEndpointAuthMethod: existing.tokenEndpointAuthMethod,
    };
  }

  const clientMetadataUrl = getConnectorClientMetadataUrl();
  const supportsCimd = metadata.client_id_metadata_document_supported === true;
  if (supportsCimd && isClientMetadataUrlReachable(clientMetadataUrl)) {
    return {
      clientId: clientMetadataUrl,
      scheme: 'client_id_metadata_document',
      tokenEndpointAuthMethod: 'none',
    };
  }

  if (!metadata.registration_endpoint) {
    throw new Error(
      supportsCimd
        ? 'This server only accepts Client ID Metadata Documents, which need LobeHub on a public HTTPS APP_URL. Provide the OAuth Client ID you registered with this server.'
        : 'This server supports neither Client ID Metadata Documents nor dynamic registration. Provide the OAuth Client ID you registered with this server.',
    );
  }
  const registration = await registerDynamicClient(params).catch((error: unknown) => {
    throw new Error(
      `Dynamic client registration failed: ${(error as Error)?.message ?? String(error)}`,
      { cause: error },
    );
  });
  return {
    clientId: registration.client_id,
    clientSecret: registration.client_secret ?? undefined,
    scheme: 'dcr',
    tokenEndpointAuthMethod: registeredAuthMethod(registration, metadata),
  };
};

const TOKEN_ENDPOINT_AUTH_METHODS = new Set<string>([
  'client_secret_basic',
  'client_secret_post',
  'none',
]);

/**
 * The token endpoint auth method a dynamic registration settled on: what the
 * server echoed back (it may override the request), else what was requested.
 */
export const registeredAuthMethod = (
  registration: OAuthClientInformationFull,
  metadata: AuthorizationServerMetadata,
): RegistrationAuthMethod => {
  const echoed = registration.token_endpoint_auth_method;
  return echoed && TOKEN_ENDPOINT_AUTH_METHODS.has(echoed)
    ? (echoed as RegistrationAuthMethod)
    : selectRegistrationAuthMethod(metadata);
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

type TokenEndpointAuthMethod = NonNullable<OIDCConfig['tokenEndpointAuthMethod']>;

/**
 * Client information for token requests. The stored auth method is passed
 * through so the SDK uses it instead of its own preference (it picks
 * `client_secret_basic` whenever a secret exists), which servers that enforce
 * the registered method reject with `invalid_client`.
 */
export const toClientInformation = (
  oidc: Pick<OIDCConfig, 'clientId' | 'clientSecret' | 'tokenEndpointAuthMethod'>,
): OAuthClientInformationMixed => ({
  client_id: oidc.clientId!,
  client_secret: oidc.clientSecret,
  ...(oidc.tokenEndpointAuthMethod && {
    token_endpoint_auth_method: oidc.tokenEndpointAuthMethod,
  }),
});

const alternateSecretMethod = (
  clientInformation: OAuthClientInformationMixed,
  metadata: AuthorizationServerMetadata,
): TokenEndpointAuthMethod | undefined => {
  if (!clientInformation.client_secret) return;
  if (
    'token_endpoint_auth_method' in clientInformation &&
    clientInformation.token_endpoint_auth_method
  )
    return;
  // Without a recorded method the SDK tried basic when the server supports it,
  // and post otherwise; the other one is the only remaining confidential option.
  const supported = metadata.token_endpoint_auth_methods_supported ?? [];
  const tried =
    supported.length === 0 || supported.includes('client_secret_basic')
      ? 'client_secret_basic'
      : 'client_secret_post';
  const other = tried === 'client_secret_basic' ? 'client_secret_post' : 'client_secret_basic';
  return supported.length === 0 || supported.includes(other) ? other : undefined;
};

/**
 * Run a token request, retrying once with the other confidential auth method
 * when the server rejects the client and no method is on record — the case
 * for pre-registered clients, whose registered method the user never told us.
 * Returns the method that worked so callers can persist it.
 */
const withClientAuthFallback = async (
  clientInformation: OAuthClientInformationMixed,
  metadata: AuthorizationServerMetadata,
  request: (clientInformation: OAuthClientInformationMixed) => Promise<OAuthTokens>,
): Promise<{ authMethod?: TokenEndpointAuthMethod; tokens: OAuthTokens }> => {
  try {
    return { tokens: await request(clientInformation) };
  } catch (error) {
    const other =
      OAuthError.isInstance(error) &&
      error.code === OAuthErrorCode.InvalidClient &&
      alternateSecretMethod(clientInformation, metadata);
    if (!other) throw error;
    log('token endpoint rejected client auth, retrying with %s', other);
    const tokens = await request({ ...clientInformation, token_endpoint_auth_method: other });
    return { authMethod: other, tokens };
  }
};

/** Exchange the authorization code for tokens (callback step). */
export const exchangeConnectorCode = async (params: {
  authorizationCode: string;
  authorizationServerUrl: string;
  clientInformation: OAuthClientInformationMixed;
  codeVerifier: string;
  iss?: string;
  metadata: AuthorizationServerMetadata;
  redirectUri: string;
  resource?: string;
}): Promise<{ authMethod?: TokenEndpointAuthMethod; tokens: OAuthTokens }> =>
  withClientAuthFallback(params.clientInformation, params.metadata, (clientInformation) =>
    exchangeAuthorization(params.authorizationServerUrl, {
      authorizationCode: params.authorizationCode,
      clientInformation,
      codeVerifier: params.codeVerifier,
      fetchFn: connectorFetch,
      iss: params.iss,
      metadata: params.metadata,
      redirectUri: params.redirectUri,
      resource: params.resource ? new URL(params.resource) : undefined,
    }),
  );

/** Refresh an expired access token using the stored refresh token. */
export const refreshConnectorToken = async (params: {
  authorizationServerUrl: string;
  clientInformation: OAuthClientInformationMixed;
  metadata: AuthorizationServerMetadata;
  refreshToken: string;
  resource?: string;
}): Promise<{ authMethod?: TokenEndpointAuthMethod; tokens: OAuthTokens }> =>
  withClientAuthFallback(params.clientInformation, params.metadata, (clientInformation) =>
    refreshAuthorization(params.authorizationServerUrl, {
      clientInformation,
      fetchFn: connectorFetch,
      metadata: params.metadata,
      refreshToken: params.refreshToken,
      resource: params.resource ? new URL(params.resource) : undefined,
    }),
  );
