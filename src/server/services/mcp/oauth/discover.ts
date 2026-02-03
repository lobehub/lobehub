import type {
  McpOAuthDiscoverResultType,
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from './types';

/**
 * Build well-known URL for protected resource metadata.
 * RFC 9728: /.well-known/oauth-protected-resource
 * For MCP base URL like https://mcp.example.com/path, we use the origin + path.
 */
function getProtectedResourceWellKnownUrl(mcpBaseUrl: string): string {
  const url = new URL(mcpBaseUrl);
  const pathname = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const base = `${url.origin}${pathname || ''}`;
  return `${base}/.well-known/oauth-protected-resource`;
}

/**
 * Fetch protected resource metadata (RFC 9728) from a given well-known URL.
 * Returns null on non-2xx or invalid response.
 */
async function fetchWellKnown(
  wellKnownUrl: string,
): Promise<OAuthProtectedResourceMetadata | null> {
  const res = await fetch(wellKnownUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as unknown;
  if (!body || typeof body !== 'object') return null;
  const meta = body as OAuthProtectedResourceMetadata;
  if (!Array.isArray(meta.authorization_servers) || meta.authorization_servers.length === 0) {
    return null;
  }
  return meta;
}

/**
 * Fetch protected resource metadata (RFC 9728).
 * Tries path-based URL first (e.g. https://mcp.example.com/mcp/.well-known/...),
 * then origin-based fallback (e.g. https://mcp.example.com/.well-known/...) for servers
 * that only serve well-known at the origin (e.g. Notion MCP).
 */
export async function fetchProtectedResourceMetadata(
  mcpBaseUrl: string,
): Promise<OAuthProtectedResourceMetadata | null> {
  const pathBasedUrl = getProtectedResourceWellKnownUrl(mcpBaseUrl);
  const meta = await fetchWellKnown(pathBasedUrl);
  if (meta) return meta;
  const url = new URL(mcpBaseUrl);
  const originBasedUrl = `${url.origin}/.well-known/oauth-protected-resource`;
  return fetchWellKnown(originBasedUrl);
}

/**
 * Fetch authorization server metadata (RFC 8414).
 * Fails if authorization_endpoint or token_endpoint missing.
 */
export async function fetchAuthorizationServerMetadata(
  authServerUrl: string,
): Promise<OAuthAuthorizationServerMetadata | null> {
  const url = authServerUrl.endsWith('/')
    ? `${authServerUrl}.well-known/oauth-authorization-server`
    : `${authServerUrl}/.well-known/oauth-authorization-server`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as unknown;
  if (!body || typeof body !== 'object') return null;
  const meta = body as OAuthAuthorizationServerMetadata;
  if (!meta.authorization_endpoint || !meta.token_endpoint) return null;
  return meta;
}

/**
 * Single path: discovery is the only source of truth for OAuth-required.
 * If discovery fails or no valid authorization_servers → requiresOAuth: false.
 * If registration_endpoint missing → throw (we require dynamic registration).
 */
export async function discover(mcpUrl: string): Promise<McpOAuthDiscoverResultType> {
  const protectedMeta = await fetchProtectedResourceMetadata(mcpUrl);
  if (!protectedMeta || !protectedMeta.authorization_servers?.length) {
    return { requiresOAuth: false };
  }

  const authServerUrl = protectedMeta.authorization_servers[0];
  const serverMetadata = await fetchAuthorizationServerMetadata(authServerUrl);
  if (!serverMetadata) {
    return { requiresOAuth: false };
  }

  if (!serverMetadata.registration_endpoint) {
    throw new Error('MCP_OAuth_NoRegistrationEndpoint');
  }

  const providerName = protectedMeta.resource_name ?? new URL(mcpUrl).hostname ?? authServerUrl;

  return {
    authorization_servers: protectedMeta.authorization_servers,
    providerName,
    requiresOAuth: true,
    serverMetadata,
  };
}
