import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGENT_SIGNAL_DEFAULTS } from '../../constants';
import { inMemoryRuntimeGuardBackend } from './memoryGuard';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('inMemoryRuntimeGuardBackend', () => {
  it('should share action guard state until the local TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    await expect(
      inMemoryRuntimeGuardBackend.touchGuardState('scope-1', 'action-1', 1_000),
    ).resolves.toEqual({
      lastEventAt: 1_000,
      startedAt: 1_000,
    });
    await expect(inMemoryRuntimeGuardBackend.getGuardState('scope-1', 'action-1')).resolves.toEqual(
      {
        lastEventAt: 1_000,
        startedAt: 1_000,
      },
    );

    await vi.advanceTimersByTimeAsync(AGENT_SIGNAL_DEFAULTS.runtimeGuardTtlSeconds * 1000 + 1);

    await expect(inMemoryRuntimeGuardBackend.getGuardState('scope-1', 'action-1')).resolves.toEqual(
      {},
    );
  });
});
