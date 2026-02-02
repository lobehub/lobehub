import type {
  DynamicRegistrationPayload,
  DynamicRegistrationResponse,
  OAuthAuthorizationServerMetadata,
} from './types';

/**
 * Dynamic client registration (RFC 7591).
 * Returns client_id (and optionally client_secret).
 */
export async function registerClient(
  registrationEndpoint: string,
  metadata: OAuthAuthorizationServerMetadata,
  redirectUri: string,
  clientName?: string,
): Promise<DynamicRegistrationResponse> {
  const payload: DynamicRegistrationPayload = {
    client_name: clientName ?? 'LobeHub MCP',
    grant_types: ['authorization_code', 'refresh_token'],
    redirect_uris: [redirectUri],
    response_types: ['code'],
    scope: Array.isArray(metadata.scopes_supported)
      ? metadata.scopes_supported.join(' ')
      : 'openid',
    token_endpoint_auth_method: 'none',
  };

  const res = await fetch(registrationEndpoint, {
    body: JSON.stringify(payload),
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP_OAuth_RegistrationFailed: ${res.status} ${text}`);
  }

  const body = (await res.json()) as unknown;
  if (!body || typeof body !== 'object' || !('client_id' in body)) {
    throw new Error('MCP_OAuth_RegistrationInvalidResponse');
  }

  return body as DynamicRegistrationResponse;
}
