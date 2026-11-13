// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { inboundWebhook } from './inboundWebhook';

const getRedisServiceClient = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ getRedisServiceClient }));

let domain: typeof inboundWebhook;
const store = new Map<string, number>();
const deleteClaim = async (key: string) => Number(store.delete(key));
const setClaim = async (key: string, _value: string, options: { nx: boolean; px: number }) => {
  if ((store.get(key) ?? 0) > Date.now() && options.nx) return null;
  store.set(key, Date.now() + options.px);
  return 'OK';
};
const redis = { del: vi.fn(deleteClaim), set: vi.fn(setClaim) };

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  redis.del.mockImplementation(deleteClaim);
  redis.set.mockImplementation(setClaim);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  store.clear();
  getRedisServiceClient.mockResolvedValue(redis);
  ({ inboundWebhook: domain } = await import('./inboundWebhook'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const claim = (
  method: 'claimDelivery' | 'claimWakeWindow' | 'claimCheck' | 'claimMaintenance' | 'claimSweep',
) =>
  method === 'claimDelivery'
    ? domain.claimDelivery('webhook', 'event')
    : method === 'claimSweep'
      ? domain.claimSweep()
      : domain[method]('webhook');

describe('inbound webhook Redis claim policy', () => {
  it.each([
    ['claimDelivery', 'delivery:v1:webhook:event', 86_400_000],
    ['claimWakeWindow', 'wake:v1:webhook', 10_000],
    ['claimCheck', 'check:v1:webhook', 30_000],
    ['claimMaintenance', 'maintenance:v1:webhook', 60_000],
    ['claimSweep', 'sweep:v1:slot', 60_000],
  ] as const)('uses the %s lease and reopens exactly at its expiry', async (method, key, ttl) => {
    expect(await claim(method)).toBe(true);
    expect(await claim(method)).toBe(false);
    expect(getRedisServiceClient).toHaveBeenCalledWith('inboundWebhook');
    expect(redis.set).toHaveBeenCalledWith(key, '1', { nx: true, px: ttl });
    vi.advanceTimersByTime(ttl - 1);
    expect(await claim(method)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(await claim(method)).toBe(true);
  });

  it('isolates subscriptions, deliveries and claim purposes', async () => {
    expect(await domain.claimDelivery('webhook-a', 'event')).toBe(true);
    expect(await domain.claimDelivery('webhook-b', 'event')).toBe(true);
    expect(await domain.claimDelivery('webhook-a', 'next-event')).toBe(true);
    expect(await domain.claimWakeWindow('webhook-a')).toBe(true);
    expect(await domain.claimCheck('webhook-a')).toBe(true);
    expect(await domain.claimMaintenance('webhook-a')).toBe(true);
    expect(await domain.claimSweep()).toBe(true);
    expect(await domain.claimDelivery('webhook-a', 'event')).toBe(false);
  });

  it('releases only the failed delivery so retries can claim it immediately', async () => {
    await domain.claimDelivery('webhook', 'event');
    await domain.claimDelivery('webhook', 'next-event');
    await domain.claimWakeWindow('webhook');
    await domain.releaseDelivery('webhook', 'event');
    expect(redis.del).toHaveBeenCalledWith('delivery:v1:webhook:event');
    expect(await domain.claimDelivery('webhook', 'event')).toBe(true);
    expect(await domain.claimDelivery('webhook', 'next-event')).toBe(false);
    expect(await domain.claimWakeWindow('webhook')).toBe(false);
  });

  it('uses real process-local claims while Redis is unavailable, including expiry and release', async () => {
    getRedisServiceClient.mockResolvedValue(null);
    expect(await domain.claimDelivery('fallback', 'event')).toBe(true);
    expect(await domain.claimDelivery('fallback', 'event')).toBe(false);
    expect(await domain.claimWakeWindow('fallback')).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(await domain.claimWakeWindow('fallback')).toBe(true);
    expect(await domain.claimDelivery('fallback', 'event')).toBe(false);
    await domain.releaseDelivery('fallback', 'event');
    expect(await domain.claimDelivery('fallback', 'event')).toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('retains local deduplication after Redis command failures and releases it even if DEL fails', async () => {
    redis.set.mockRejectedValue(new Error('Redis unavailable'));
    redis.del.mockRejectedValue(new Error('Redis unavailable'));
    expect(await domain.claimDelivery('unavailable', 'event')).toBe(true);
    expect(await domain.claimDelivery('unavailable', 'event')).toBe(false);
    await expect(domain.releaseDelivery('unavailable', 'event')).resolves.toBeUndefined();
    expect(await domain.claimDelivery('unavailable', 'event')).toBe(true);
  });
});
