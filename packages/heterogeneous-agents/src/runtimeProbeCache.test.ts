import { describe, expect, it, vi } from 'vitest';

import { createRuntimeProbeCache } from './runtimeProbeCache';

describe('createRuntimeProbeCache', () => {
  /** @example Repeated system-info requests share one native probe. */
  it('probes once for concurrent and repeated reads', async () => {
    const probe = vi.fn().mockResolvedValue(['codex-app-server-v1']);
    const cache = createRuntimeProbeCache(probe);

    const [first, second] = await Promise.all([cache.get(), cache.get()]);
    const third = await cache.get();

    expect(first).toEqual(['codex-app-server-v1']);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(probe).toHaveBeenCalledOnce();
  });

  /** @example A reconnect reprobes, so a downgraded binary revokes its capability. */
  it('reprobes after invalidation', async () => {
    const probe = vi.fn().mockResolvedValueOnce(['codex-app-server-v1']).mockResolvedValueOnce([]);
    const cache = createRuntimeProbeCache(probe);

    expect(await cache.get()).toEqual(['codex-app-server-v1']);
    cache.invalidate();
    expect(await cache.get()).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  /** @example An installed or upgraded binary is picked up after the entry expires. */
  it('reprobes after the entry expires', async () => {
    let time = 0;
    const probe = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(['codex-app-server-v1']);
    const cache = createRuntimeProbeCache(probe, { now: () => time, ttlMs: 1000 });

    expect(await cache.get()).toEqual([]);
    time = 999;
    expect(await cache.get()).toEqual([]);
    time = 1000;
    expect(await cache.get()).toEqual(['codex-app-server-v1']);
  });

  /** @example A failing probe reports no runtimes instead of rejecting system info. */
  it('treats a rejected probe as no supported runtimes', async () => {
    const cache = createRuntimeProbeCache(() => Promise.reject(new Error('spawn failed')));
    expect(await cache.get()).toEqual([]);
  });
});
