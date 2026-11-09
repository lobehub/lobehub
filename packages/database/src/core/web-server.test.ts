import { describe, expect, it } from 'vitest';

import { buildPoolOptions } from './web-server';

describe('buildPoolOptions', () => {
  it('bounds the wait for a pool connection by default', () => {
    expect(buildPoolOptions({})).toEqual({ connectionTimeoutMillis: 30_000 });
  });

  it('lets DATABASE_POOL_ACQUIRE_TIMEOUT override the wait, including 0 for no limit', () => {
    expect(buildPoolOptions({ DATABASE_POOL_ACQUIRE_TIMEOUT: 5000 })).toEqual({
      connectionTimeoutMillis: 5000,
    });
    expect(buildPoolOptions({ DATABASE_POOL_ACQUIRE_TIMEOUT: 0 })).toEqual({
      connectionTimeoutMillis: 0,
    });
  });

  it('keeps the server-side statement and idle-in-transaction timeouts', () => {
    expect(buildPoolOptions({ DATABASE_STATEMENT_TIMEOUT: 60_000 })).toEqual({
      connectionTimeoutMillis: 30_000,
      idle_in_transaction_session_timeout: 60_000,
      statement_timeout: 60_000,
    });
  });
});
