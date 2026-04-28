import { createDecipheriv, createHash } from 'node:crypto';

import type { Context, MiddlewareHandler } from 'hono';

import type { MarketHonoEnv, TrustedClientPayload } from '../types';
import { getMarketEnv } from './context';
import { MarketHttpError } from './errors';

const CRYPTO = {
  ALGORITHM: 'aes-256-gcm',
  AUTH_TAG_LENGTH: 16,
  IV_LENGTH: 12,
  KEY_LENGTH: 32,
} as const;

const SECRET_PREFIX = 'lobehub-market_tcs_';

const deriveKey = (secret: string) => {
  if (secret.startsWith(SECRET_PREFIX)) {
    return createHash('sha256').update(secret).digest();
  }

  const key = Buffer.from(secret, 'hex');
  if (key.length !== CRYPTO.KEY_LENGTH) {
    throw new MarketHttpError(
      500,
      'invalid_trusted_client_secret',
      'Trusted client secret is invalid.',
    );
  }

  return key;
};

export const verifyTrustedToken = (
  token: string,
  options: { clientId: string; maxAgeMs: number; secret: string },
): TrustedClientPayload => {
  try {
    const encrypted = Buffer.from(token, 'base64');
    const iv = encrypted.subarray(0, CRYPTO.IV_LENGTH);
    const authTag = encrypted.subarray(encrypted.length - CRYPTO.AUTH_TAG_LENGTH);
    const ciphertext = encrypted.subarray(
      CRYPTO.IV_LENGTH,
      encrypted.length - CRYPTO.AUTH_TAG_LENGTH,
    );
    const decipher = createDecipheriv(CRYPTO.ALGORITHM, deriveKey(options.secret), iv);

    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
    const payload = JSON.parse(plaintext) as TrustedClientPayload;

    if (payload.clientId !== options.clientId) {
      throw new MarketHttpError(401, 'invalid_trusted_client', 'Trusted client is not allowed.');
    }

    if (!payload.userId || !payload.email) {
      throw new MarketHttpError(
        401,
        'invalid_trusted_payload',
        'Trusted token is missing user identity.',
      );
    }

    if (!Number.isFinite(payload.timestamp)) {
      throw new MarketHttpError(
        401,
        'invalid_trusted_payload',
        'Trusted token timestamp is invalid.',
      );
    }

    if (Date.now() - payload.timestamp > options.maxAgeMs) {
      throw new MarketHttpError(401, 'expired_trusted_token', 'Trusted token has expired.');
    }

    return payload;
  } catch (error) {
    if (error instanceof MarketHttpError) throw error;
    throw new MarketHttpError(401, 'invalid_trusted_token', 'Trusted token could not be verified.');
  }
};

export const getTrustedPayload = (c: Context<MarketHonoEnv>) => {
  const token = c.req.header('x-lobe-trust-token');
  if (!token) return undefined;
  const env = getMarketEnv(c);

  return verifyTrustedToken(token, {
    clientId: env.MARKET_TRUSTED_CLIENT_ID,
    maxAgeMs: 5 * 60 * 1000,
    secret: env.MARKET_TRUSTED_CLIENT_SECRET,
  });
};

export const trustedAuth = (): MiddlewareHandler<MarketHonoEnv> => async (c, next) => {
  const payload = getTrustedPayload(c);

  if (!payload) {
    throw new MarketHttpError(401, 'missing_trusted_token', 'A trusted client token is required.');
  }

  c.set('trustedPayload', payload);
  await next();
};

export const optionalTrustedAuth = (): MiddlewareHandler<MarketHonoEnv> => async (c, next) => {
  const payload = getTrustedPayload(c);
  if (payload) c.set('trustedPayload', payload);
  await next();
};
