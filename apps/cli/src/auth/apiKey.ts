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

export class ApiKeyValidationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiKeyValidationError';
  }
}

export async function getUserIdFromApiKey(apiKey: string, serverUrl?: string): Promise<string> {
  const normalizedServerUrl = normalizeUrl(serverUrl) || resolveServerUrl();

  let response: Response;
  try {
    response = await fetch(`${normalizedServerUrl}/api/v1/users/me?includeCount=0`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (error) {
    throw new ApiKeyValidationError(error instanceof Error ? error.message : String(error), true);
  }
  const retryableStatus = response.status >= 500 || [408, 425, 429].includes(response.status);

  let body: CurrentUserResponse | undefined;
  try {
    body = (await response.json()) as CurrentUserResponse;
  } catch {
    throw new ApiKeyValidationError(
      `Failed to parse response from ${normalizedServerUrl}/api/v1/users/me?includeCount=0.`,
      response.ok || retryableStatus,
    );
  }

  if (!response.ok || body?.success === false) {
    throw new ApiKeyValidationError(
      body?.error || body?.message || `Request failed with status ${response.status}.`,
      retryableStatus,
    );
  }

  const userId = body?.data?.id || body?.data?.userId;
  if (!userId) {
    throw new ApiKeyValidationError('Current user response did not include a user id.', true);
  }

  return userId;
}
