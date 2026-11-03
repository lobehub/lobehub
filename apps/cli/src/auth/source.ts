import os from 'node:os';
import path from 'node:path';

import { readCliApiKeyEnvSource, resolveCliDirName } from '../constants/identity';
import { loadCredentials } from './credentials';

export type AuthSourceKind =
  'env-jwt' | 'option-token' | 'option-service-token' | 'env-api-key' | 'stored';

export interface AuthSource {
  kind: AuthSourceKind;
  /** Where the credential came from, phrased the way a user would recognise it. */
  origin: string;
  /**
   * The raw credential, when one exists. Empty for `stored` when nothing has
   * been logged in — the fallback kind is returned regardless so callers keep
   * their existing "try the stored login, then complain" flow.
   */
  token?: string;
  tokenType: 'apiKey' | 'jwt' | 'serviceToken';
}

/**
 * Decide WHICH credential a command authenticates with, in one place.
 *
 * The precedence — `LOBEHUB_JWT` (server-dispatched runs) > explicit flags >
 * `LOBEHUB_CLI_API_KEY` > the stored login — was previously spelled out
 * separately in `resolveToken` and in the tRPC client's `getAuthAndServer`.
 * `lh doctor` needs to report the winner without performing the login, which
 * would have made a third copy; two copies had already drifted apart on which
 * env var names they accept.
 *
 * Deliberately does not refresh or validate anything: `stored` yields the
 * token as written on disk, and callers that need a live token still go
 * through `getValidToken()`.
 */
export function pickAuthSource(
  options: { serviceToken?: string; token?: string } = {},
): AuthSource {
  const envJwt = process.env.LOBEHUB_JWT;
  if (envJwt) return { kind: 'env-jwt', origin: 'LOBEHUB_JWT', token: envJwt, tokenType: 'jwt' };

  if (options.token)
    return { kind: 'option-token', origin: '--token', token: options.token, tokenType: 'jwt' };

  if (options.serviceToken)
    return {
      kind: 'option-service-token',
      origin: '--service-token',
      token: options.serviceToken,
      tokenType: 'serviceToken',
    };

  const apiKey = readCliApiKeyEnvSource();
  if (apiKey)
    return { kind: 'env-api-key', origin: apiKey.name, token: apiKey.value, tokenType: 'apiKey' };

  return {
    kind: 'stored',
    origin: `stored login (${credentialsPath()})`,
    token: loadCredentials()?.accessToken,
    tokenType: 'jwt',
  };
}

/** Path of the credentials file, for diagnostics that name it. */
export function credentialsPath(): string {
  return path.join(os.homedir(), resolveCliDirName(), 'credentials.json');
}

/** Last 4 characters of a secret, everything else elided. */
export function maskSecret(token: string | undefined): string {
  if (!token) return 'none';
  return token.length <= 4 ? '****' : `…${token.slice(-4)}`;
}

/** Parse a JWT's payload without verifying the signature. */
export function parseJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    );
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
