import { afterEach, describe, expect, it } from 'vitest';

import { assertCronAuth } from './cronAuth';

describe('assertCronAuth', () => {
  const prev = process.env.CRON_SECRET;

  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it('returns 503 when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    const res = assertCronAuth({ headers: { get: () => 'Bearer anything' } }, undefined);
    expect(res).toEqual({ error: 'Service not configured', status: 503 });
  });

  it('returns 401 when bearer does not match', () => {
    const res = assertCronAuth(
      { headers: { get: () => 'Bearer wrong' } },
      'expected-secret',
    );
    expect(res).toEqual({ error: 'Unauthorized', status: 401 });
  });

  it('returns null when bearer matches', () => {
    const res = assertCronAuth(
      { headers: { get: () => 'Bearer expected-secret' } },
      'expected-secret',
    );
    expect(res).toBeNull();
  });
});
