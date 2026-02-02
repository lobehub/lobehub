import type { TokenResponse } from './types';

/**
 * Exchange authorization code for tokens (RFC 6749, PKCE).
 */
export async function exchangeCode(params: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  tokenEndpoint: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });

  const res = await fetch(params.tokenEndpoint, {
    body: body.toString(),
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    const error = data.error === 'invalid_grant' ? 'invalid_grant' : 'token_exchange_failed';
    throw new Error(`${error}: ${data.error_description ?? res.statusText}`);
  }

  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object' || !('access_token' in data)) {
    throw new Error('token_exchange_failed: Invalid token response');
  }

  return data as TokenResponse;
}
