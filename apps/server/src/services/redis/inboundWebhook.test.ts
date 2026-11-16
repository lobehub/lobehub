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

const claim = (method: 'claimWakeWindow' | 'claimCheck' | 'claimMaintenance' | 'claimSweep') =>
  method === 'claimSweep' ? domain.claimSweep() : domain[method]('webhook');

describe('inbound webhook Redis claim policy', () => {
  it.each([
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

  it('isolates subscriptions and claim purposes', async () => {
    expect(await domain.claimWakeWindow('webhook-a')).toBe(true);
    expect(await domain.claimWakeWindow('webhook-b')).toBe(true);
    expect(await domain.claimCheck('webhook-a')).toBe(true);
    expect(await domain.claimMaintenance('webhook-a')).toBe(true);
    expect(await domain.claimSweep()).toBe(true);
    expect(await domain.claimWakeWindow('webhook-a')).toBe(false);
  });

  it('keeps process-local leases with expiry while Redis is unavailable', async () => {
    getRedisServiceClient.mockResolvedValue(null);
    expect(await domain.claimWakeWindow('fallback')).toBe(true);
    expect(await domain.claimWakeWindow('fallback')).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(await domain.claimWakeWindow('fallback')).toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('keeps fallback leases even after Redis command failures', async () => {
    redis.set.mockRejectedValue(new Error('Redis unavailable'));
    expect(await domain.claimCheck('unavailable')).toBe(true);
    expect(await domain.claimCheck('unavailable')).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(await domain.claimCheck('unavailable')).toBe(true);
  });
});
