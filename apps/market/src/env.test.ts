import { describe, expect, it } from 'vitest';

import { loadEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://postgres:password@localhost:5432/lobechat',
  MARKET_TRUSTED_CLIENT_ID: 'internal-lobehub',
  MARKET_TRUSTED_CLIENT_SECRET:
    'lobehub-market_tcs_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
};

describe('loadEnv', () => {
  it('rejects the documented placeholder trusted client secret', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        MARKET_TRUSTED_CLIENT_SECRET:
          'lobehub-market_tcs_0000000000000000000000000000000000000000000000000000000000000000',
      }),
    ).toThrow('MARKET_TRUSTED_CLIENT_SECRET');
  });

  it('rejects the setup-generated trusted client secret placeholder', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        MARKET_TRUSTED_CLIENT_SECRET: 'REPLACE_WITH_SETUP_GENERATED_MARKET_TRUSTED_CLIENT_SECRET',
      }),
    ).toThrow('MARKET_TRUSTED_CLIENT_SECRET');
  });
});
