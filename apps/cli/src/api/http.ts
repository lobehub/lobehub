import { getValidToken } from '../auth/refresh';
import { CLI_API_KEY_ENV } from '../constants/auth';
import { resolveServerUrl } from '../settings';
import { log } from '../utils/logger';
import { withWorkspaceHeader } from './workspace';

export interface AuthInfo {
  accessToken: string;
  /** Headers required for /webapi/* endpoints (Oidc-Auth for authentication) */
  headers: Record<string, string>;
  serverUrl: string;
}

export async function getAuthInfo(workspaceId?: string): Promise<AuthInfo> {
  const serverUrl = resolveServerUrl();
  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) {
    return {
      accessToken: envJwt,
      headers: withWorkspaceHeader(
        {
          'Content-Type': 'application/json',
          'Oidc-Auth': envJwt,
        },
        workspaceId,
      ),
      serverUrl,
    };
  }

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

  return {
    accessToken,
    headers: withWorkspaceHeader(
      {
        'Content-Type': 'application/json',
        'Oidc-Auth': accessToken,
      },
      workspaceId,
    ),
    serverUrl,
  };
}

export type AgentStreamTokenType = 'jwt' | 'apiKey';

export interface AgentStreamAuthInfo {
  headers: Record<string, string>;
  serverUrl: string;
  /**
   * Raw token value (without header prefix). Used for WebSocket auth messages
   * where header-based auth is not available.
   */
  token: string;
  /**
   * How the token should be verified by downstream services (agent gateway WS).
   * jwt  → validate with JWKS
   * apiKey → validate by calling /api/v1/users/me
   */
  tokenType: AgentStreamTokenType;
}

export async function getAgentStreamAuthInfo(workspaceId?: string): Promise<AgentStreamAuthInfo> {
  const serverUrl = resolveServerUrl();

  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) {
    return {
      headers: withWorkspaceHeader({ 'Oidc-Auth': envJwt }, workspaceId),
      serverUrl,
      token: envJwt,
      tokenType: 'jwt',
    };
  }

  const envApiKey = process.env[CLI_API_KEY_ENV];
  if (envApiKey) {
    return {
      headers: withWorkspaceHeader({ 'X-API-Key': envApiKey }, workspaceId),
      serverUrl,
      token: envApiKey,
      tokenType: 'apiKey',
    };
  }

  const result = await getValidToken();
  if (!result) {
    log.error(`No authentication found. Run 'lh login' first, or set ${CLI_API_KEY_ENV}.`);
    process.exit(1);

    return {
      headers: {},
      serverUrl,
      token: '',
      tokenType: 'jwt',
    };
  }

  return {
    headers: withWorkspaceHeader({ 'Oidc-Auth': result.credentials.accessToken }, workspaceId),
    serverUrl,
    token: result.credentials.accessToken,
    tokenType: 'jwt',
  };
}
