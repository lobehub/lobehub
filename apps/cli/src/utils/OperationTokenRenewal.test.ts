import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOperationTokenRenewal } from './OperationTokenRenewal';

vi.mock('./logger', () => ({ log: { warn: vi.fn() } }));

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-14T00:00:00.000Z').getTime();

const token = (payload: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const operationToken = (expiresAt: number) =>
  token({ exp: Math.floor(expiresAt / 1000), purpose: 'hetero-operation' });

const originalJwt = process.env.LOBEHUB_JWT;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  if (originalJwt === undefined) delete process.env.LOBEHUB_JWT;
  else process.env.LOBEHUB_JWT = originalJwt;
});

/**
 * Regression: a Goal Task ran past the four hours its operation token was
 * signed for. From then on every ingest — heartbeats included — was rejected
 * with "exp claim timestamp check failed", so the run's output and its
 * completion never reached the server while the agent kept working.
 */
describe('createOperationTokenRenewal', () => {
  it('swaps in a renewed token before the current one expires, then keeps renewing', async () => {
    process.env.LOBEHUB_JWT = operationToken(NOW + 4 * HOUR);
    const renewed = [operationToken(NOW + 7 * HOUR), operationToken(NOW + 10 * HOUR)];
    const renew = vi
      .fn()
      .mockResolvedValueOnce({ jwt: renewed[0] })
      .mockResolvedValueOnce({ jwt: renewed[1] });

    const renewal = createOperationTokenRenewal({ operationId: 'op-1', renew });
    expect(renewal.active).toBe(true);

    await vi.advanceTimersByTimeAsync(3 * HOUR - 1);
    expect(renew).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(renew).toHaveBeenCalledWith('op-1');
    expect(process.env.LOBEHUB_JWT).toBe(renewed[0]);

    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(process.env.LOBEHUB_JWT).toBe(renewed[1]);

    renewal.stop();
  });

  it('retries a transient failure instead of letting the token lapse', async () => {
    process.env.LOBEHUB_JWT = operationToken(NOW + 4 * HOUR);
    const next = operationToken(NOW + 8 * HOUR);
    const renew = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ jwt: next });

    const renewal = createOperationTokenRenewal({ operationId: 'op-1', renew });
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(renew).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(process.env.LOBEHUB_JWT).toBe(next);

    renewal.stop();
  });

  it('stops once the server says the operation can no longer be renewed', async () => {
    process.env.LOBEHUB_JWT = operationToken(NOW + 4 * HOUR);
    const renew = vi.fn().mockRejectedValue({ data: { code: 'CONFLICT' }, message: 'ended' });

    const renewal = createOperationTokenRenewal({ operationId: 'op-1', renew });
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    await vi.advanceTimersByTimeAsync(2 * HOUR);

    expect(renew).toHaveBeenCalledTimes(1);
    renewal.stop();
  });

  it('does not poll a server that has no renewal endpoint', async () => {
    process.env.LOBEHUB_JWT = operationToken(NOW + 4 * HOUR);
    const renew = vi.fn().mockRejectedValue({ data: { code: 'NOT_FOUND' }, message: 'No procedure' });

    const renewal = createOperationTokenRenewal({ operationId: 'op-1', renew });
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    await vi.advanceTimersByTimeAsync(2 * HOUR);

    expect(renew).toHaveBeenCalledTimes(1);
    renewal.stop();
  });

  it('leaves a desktop session token to its own refresh flow', async () => {
    process.env.LOBEHUB_JWT = token({ exp: Math.floor((NOW + HOUR) / 1000), sub: 'user-1' });
    const renew = vi.fn();

    const renewal = createOperationTokenRenewal({ operationId: 'op-1', renew });
    await vi.advanceTimersByTimeAsync(10 * HOUR);

    expect(renewal.active).toBe(false);
    expect(renew).not.toHaveBeenCalled();
  });

  it('never renews after the run has stopped it', async () => {
    process.env.LOBEHUB_JWT = operationToken(NOW + 4 * HOUR);
    const renew = vi.fn();

    createOperationTokenRenewal({ operationId: 'op-1', renew }).stop();
    await vi.advanceTimersByTimeAsync(10 * HOUR);

    expect(renew).not.toHaveBeenCalled();
  });
});
