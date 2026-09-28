import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeliveryStatsCache } from './deliveryStatsCache';

const stats = {
  averageOperationDurationSeconds: null,
  averageWorkCost: null,
  lastDeliveredAt: null,
  workCount: 3,
};
afterEach(() => vi.useRealTimers());

describe('delivery stats cache', () => {
  it('coalesces concurrent visitors and refreshes after a minute', async () => {
    vi.useFakeTimers();
    const get = createDeliveryStatsCache();
    const db = {};
    const load = vi.fn().mockResolvedValue(stats);
    const first = get(db, 'owner', 'agent', load);
    expect(get(db, 'owner', 'agent', load)).toBe(first);
    await first;
    await get(db, 'owner', 'agent', load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await get(db, 'owner', 'agent', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('isolates databases, owners and agents and retries failures', async () => {
    const get = createDeliveryStatsCache();
    const db = {};
    const load = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(stats);
    await expect(get(db, 'owner', 'agent', load)).rejects.toThrow('unavailable');
    await get(db, 'owner', 'agent', load);
    await get(db, 'other', 'agent', load);
    await get(db, 'owner', 'other', load);
    await get({}, 'owner', 'agent', load);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('evicts old entries at the size bound', async () => {
    const get = createDeliveryStatsCache();
    const db = {};
    const load = vi.fn().mockResolvedValue(stats);
    for (let i = 0; i < 257; i++) await get(db, 'owner', String(i), load);
    await get(db, 'owner', '0', load);
    expect(load).toHaveBeenCalledTimes(258);
  });
});
