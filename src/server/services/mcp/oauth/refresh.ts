import type { TokenResponse } from './types';

/**
 * Refresh access token (RFC 6749).
 * On invalid_grant → caller should delete token row and require re-auth.
 */
export async function refreshTokens(params: {
  clientId: string;
  refreshToken: string;
  tokenEndpoint: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
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
    if (data.error === 'invalid_grant') {
      throw new Error('invalid_grant');
    }
    throw new Error(`refresh_failed: ${data.error_description ?? res.statusText}`);
  }

  const data = (await res.json()) as unknown;
  if (!data || typeof data !== 'object' || !('access_token' in data)) {
    throw new Error('refresh_failed: Invalid token response');
  }

  return data as TokenResponse;
}
