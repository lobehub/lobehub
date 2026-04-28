import { buildTrustedClientPayload, createTrustedClientToken } from '@lobehub/market-sdk';
import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { MarketHonoEnv, TrustedClientPayload } from '../types';
import { optionalTrustedAuth, verifyTrustedToken } from './auth';
import { MarketHttpError } from './errors';

const secret = 'lobehub-market_tcs_test-secret-for-market-service';
const trustedClientOptions = {
  clientId: 'internal-lobehub',
  maxAgeMs: 5 * 60 * 1000,
  secret,
};

const createToken = (payload: Partial<TrustedClientPayload> = {}) =>
  createTrustedClientToken(
    {
      clientId: 'internal-lobehub',
      email: 'aaryn@example.com',
      nonce: 'nonce',
      timestamp: Date.now(),
      userId: 'user_123',
      ...payload,
    } as TrustedClientPayload,
    secret,
  );

describe('verifyTrustedToken', () => {
  it('decrypts a valid trusted-client token', () => {
    const token = createTrustedClientToken(
      buildTrustedClientPayload({
        clientId: 'internal-lobehub',
        email: 'aaryn@example.com',
        name: 'Aaryn',
        userId: 'user_123',
      }),
      secret,
    );

    const payload = verifyTrustedToken(token, trustedClientOptions);

    expect(payload).toMatchObject({
      clientId: 'internal-lobehub',
      email: 'aaryn@example.com',
      name: 'Aaryn',
      userId: 'user_123',
    });
  });

  it('rejects a token for the wrong trusted client', () => {
    const token = createTrustedClientToken(
      buildTrustedClientPayload({
        clientId: 'other-client',
        email: 'aaryn@example.com',
        userId: 'user_123',
      }),
      secret,
    );

    expect(() => verifyTrustedToken(token, trustedClientOptions)).toThrow(MarketHttpError);
  });

  it('rejects a token with a missing timestamp', () => {
    const token = createToken({ timestamp: undefined });

    expect(() => verifyTrustedToken(token, trustedClientOptions)).toThrow(MarketHttpError);
  });

  it('rejects a token with a non-numeric timestamp', () => {
    const token = createToken({ timestamp: 'not-a-number' as unknown as number });

    expect(() => verifyTrustedToken(token, trustedClientOptions)).toThrow(MarketHttpError);
  });

  it('rejects an expired token', () => {
    const token = createToken({ timestamp: Date.now() - trustedClientOptions.maxAgeMs - 1 });

    expect(() => verifyTrustedToken(token, trustedClientOptions)).toThrow(MarketHttpError);
  });
});

describe('optionalTrustedAuth', () => {
  const createContext = (token?: string) => {
    const set = vi.fn();
    const context = {
      get: vi.fn(() => ({
        MARKET_TRUSTED_CLIENT_ID: trustedClientOptions.clientId,
        MARKET_TRUSTED_CLIENT_SECRET: trustedClientOptions.secret,
      })),
      req: {
        header: vi.fn(() => token),
      },
      set,
    } as unknown as Context<MarketHonoEnv>;

    return { context, set };
  };

  it('continues without setting a trusted payload when the trusted token is absent', async () => {
    const { context, set } = createContext();
    const next = vi.fn(async () => {});

    await optionalTrustedAuth()(context, next);

    expect(next).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects an invalid trusted token when the trusted token is present', async () => {
    const { context } = createContext('invalid-token');
    const next = vi.fn(async () => {});

    await expect(optionalTrustedAuth()(context, next)).rejects.toThrow(MarketHttpError);
    expect(next).not.toHaveBeenCalled();
  });
});
