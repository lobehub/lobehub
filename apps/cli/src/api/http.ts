import { getValidToken } from '../auth/refresh';
import { CLI_API_KEY_ENV } from '../constants/auth';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';

export interface AuthInfo {
  accessToken: string;
  /** Headers required for /webapi/* endpoints (Oidc-Auth for authentication) */
  headers: Record<string, string>;
  serverUrl: string;
}

export async function getAuthInfo(): Promise<AuthInfo> {
  const result = await getValidToken();
  if (!result) {
    if (process.env[CLI_API_KEY_ENV]) {
      log.error(
        `API key auth from ${CLI_API_KEY_ENV} is not supported for /webapi/* routes. Run OIDC login instead.`,
      );
      process.exit(1);
    }

    log.error("No authentication found. Run 'lh login' first.");
    process.exit(1);
  }

  const accessToken = result!.credentials.accessToken;
  const serverUrl = resolveServerUrl();

  return {
    accessToken,
    headers: {
      'Content-Type': 'application/json',
      'Oidc-Auth': accessToken,
    },
    serverUrl,
  };
}

export async function getAgentStreamAuthInfo(): Promise<Pick<AuthInfo, 'headers' | 'serverUrl'>> {
  const serverUrl = resolveServerUrl();

  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) {
    return {
      headers: { 'Oidc-Auth': envJwt },
      serverUrl,
    };
  }

  const envApiKey = process.env[CLI_API_KEY_ENV];
  if (envApiKey) {
    return {
      headers: { 'X-API-Key': envApiKey },
      serverUrl,
    };
  }

  const result = await getValidToken();
  if (!result) {
    log.error(`No authentication found. Run 'lh login' first, or set ${CLI_API_KEY_ENV}.`);
    process.exit(1);

    return {
      headers: {},
      serverUrl,
    };
  }

  return {
    headers: { 'Oidc-Auth': result.credentials.accessToken },
    serverUrl,
  };
}
