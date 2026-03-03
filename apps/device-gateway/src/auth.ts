import { importJWK, jwtVerify } from 'jose';

import type { Env } from './types';

let cachedKey: CryptoKey | null = null;

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
