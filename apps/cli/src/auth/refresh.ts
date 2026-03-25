import { resolveServerUrl } from '../settings';
import { loadCredentials, saveCredentials, type StoredCredentials } from './credentials';

const CLIENT_ID = 'lobehub-cli';

/**
 * Get a valid access token, refreshing if expired.
 * Returns null if no credentials or refresh fails.
 */
export async function getValidToken(): Promise<{ credentials: StoredCredentials } | null> {
  const credentials = loadCredentials();
  if (!credentials) return null;

  // Check if token is still valid (with 60s buffer)
  if (credentials.expiresAt && Date.now() / 1000 < credentials.expiresAt - 60) {
    return { credentials };
  }

  // Token expired — try refresh
  if (!credentials.refreshToken) return null;

  const serverUrl = resolveServerUrl();
  const refreshed = await refreshAccessToken(serverUrl, credentials.refreshToken);
  if (!refreshed) return null;

  const updated: StoredCredentials = {
    accessToken: refreshed.access_token,
    expiresAt: refreshed.expires_in
      ? Math.floor(Date.now() / 1000) + refreshed.expires_in
      : undefined,
    refreshToken: refreshed.refresh_token || credentials.refreshToken,
  };

  saveCredentials(updated);
  return { credentials: updated };
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type: string;
}

async function refreshAccessToken(
  serverUrl: string,
  refreshToken: string,
): Promise<TokenResponse | null> {
  try {
    const res = await fetch(`${serverUrl}/oidc/token`, {
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    const body = (await res.json()) as TokenResponse & { error?: string };

    if (!res.ok || body.error || !body.access_token) return null;

    return body;
  } catch {
    return null;
  }
}
