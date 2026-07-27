// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasActiveAcceptanceWatcher,
  releaseAcceptanceWatcher,
  renewAcceptanceWatcher,
} from '../acceptanceWatchers';

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => null,
}));

describe('acceptance watcher leases', () => {
  afterEach(() => vi.useRealTimers());

  it('tracks and releases a local watcher when Redis is unavailable', async () => {
    await renewAcceptanceWatcher('acceptance-1', 2, 'watcher-1');
    await expect(hasActiveAcceptanceWatcher('acceptance-1', 2)).resolves.toBe(true);

    await releaseAcceptanceWatcher('acceptance-1', 2, 'watcher-1');
    await expect(hasActiveAcceptanceWatcher('acceptance-1', 2)).resolves.toBe(false);
  });

  it('expires stale watcher leases', async () => {
    vi.useFakeTimers();
    await renewAcceptanceWatcher('acceptance-2', 1, 'watcher-2', 1000);
    await vi.advanceTimersByTimeAsync(1001);

    await expect(hasActiveAcceptanceWatcher('acceptance-2', 1)).resolves.toBe(false);
  });
});
