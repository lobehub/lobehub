import { importJWK, jwtVerify } from 'jose';

import type { Env } from './types';

let cachedKey: CryptoKey | null = null;

interface CurrentUserResponse {
  data?: {
    id?: string;
    userId?: string;
  };
  error?: string;
  message?: string;
  success?: boolean;
}

export interface ResolveSocketAuthOptions {
  serverUrl?: string;
  serviceToken: string;
  storedUserId?: string;
  token?: string;
  tokenType?: 'apiKey' | 'jwt' | 'serviceToken';
  verifyApiKey: (serverUrl: string, token: string) => Promise<{ userId: string }>;
  verifyJwt: (token: string) => Promise<{ userId: string }>;
}

async function getPublicKey(env: Env): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const jwks = JSON.parse(env.JWKS_PUBLIC_KEY);
  const rsaKey = jwks.keys.find((k: any) => k.alg === 'RS256');

  if (!rsaKey) {
    throw new Error('No RS256 key found in JWKS_PUBLIC_KEY');
  }

  cachedKey = (await importJWK(rsaKey, 'RS256')) as CryptoKey;
  return cachedKey;
}

export async function verifyDesktopToken(
  env: Env,
  token: string,
): Promise<{ clientId: string; userId: string }> {
  const publicKey = await getPublicKey(env);
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ['RS256'],
  });

  if (!payload.sub) throw new Error('Missing sub claim');

  return {
    clientId: payload.client_id as string,
    userId: payload.sub,
  };
}

export async function verifyApiKeyToken(
  serverUrl: string,
  token: string,
): Promise<{ userId: string }> {
  const normalizedServerUrl = new URL(serverUrl).toString().replace(/\/$/, '');

  const response = await fetch(`${normalizedServerUrl}/api/v1/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
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

  return { userId };
}

export async function resolveSocketAuth(options: ResolveSocketAuthOptions): Promise<string> {
  const { serverUrl, serviceToken, storedUserId, token, tokenType, verifyApiKey, verifyJwt } =
    options;

  if (!token) throw new Error('Missing token');

  if (tokenType === 'apiKey') {
    if (!serverUrl) throw new Error('Missing serverUrl');
    const result = await verifyApiKey(serverUrl, token);
    return result.userId;
  }

  if (token === serviceToken) {
    if (!storedUserId) throw new Error('Missing userId');
    return storedUserId;
  }

  const result = await verifyJwt(token);
  return result.userId;
}
