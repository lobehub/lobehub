import { normalizeUrl, resolveServerUrl } from '../settings';

interface CurrentUserResponse {
  data?: {
    id?: string;
    userId?: string;
  };
  error?: string;
  message?: string;
  success?: boolean;
}

export async function getUserIdFromApiKey(apiKey: string, serverUrl?: string): Promise<string> {
  const normalizedServerUrl = normalizeUrl(serverUrl) || resolveServerUrl();

  const response = await fetch(`${normalizedServerUrl}/api/v1/users/me`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  let body: CurrentUserResponse | undefined;
  try {
    body = (await response.json()) as CurrentUserResponse;
  } catch {
    throw new Error(`Failed to parse response from ${normalizedServerUrl}/api/v1/users/me.`);
  }

  if (!response.ok || body?.success === false) {
    throw new Error(
      body?.error || body?.message || `Request failed with status ${response.status}.`,
    );
  }

  const userId = body?.data?.id || body?.data?.userId;
  if (!userId) {
    throw new Error('Current user response did not include a user id.');
  }

  return userId;
}
