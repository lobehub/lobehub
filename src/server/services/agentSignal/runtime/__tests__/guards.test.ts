import { describe, expect, it, vi } from 'vitest';

import type { RuntimeBackend } from '../context';
import { createRuntimeProcessorContext } from '../context';
import { debounce, outerTimeout, throttle } from '../guards';

interface TestGuardState {
  lastEventAt?: number;
  startedAt?: number;
}

const createRuntimeBackend = (): RuntimeBackend => {
  const state = new Map<string, TestGuardState>();

  return {
    async appendToWaypoint() {},
    async getGuardState(scopeKey: string, lane: string) {
      return state.get(`${scopeKey}:${lane}`) ?? {};
    },
    async loadWaypoint() {
      return {};
    },
    async touchGuardState(scopeKey: string, lane: string, now: number) {
      const key = `${scopeKey}:${lane}`;
      const current = state.get(key) ?? {};
      const next = {
        lastEventAt: now,
        startedAt: current.startedAt ?? now,
      } satisfies TestGuardState;

      state.set(key, next);

      return next;
    },
  };
};

describe('runtime timing guards', () => {
  /**
   * @example
   * const first = await debounce(ctx, { lane: 'user-feedback', ms: 1500 });
   * const second = await debounce(ctx, { lane: 'user-feedback', ms: 1500 });
   *
   * expect(first.ok).toBe(true);
   * expect(second.wait().status).toBe('wait');
   */
  it('returns a wait result when debounce window is still active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const ctx = createRuntimeProcessorContext({
      backend: createRuntimeBackend(),
      scopeKey: 'topic:topic-1',
    });

    const first = await debounce(ctx, { lane: 'user-feedback', ms: 1_500 });
    const second = await debounce(ctx, { lane: 'user-feedback', ms: 1_500 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.delayMs).toBe(1_500);
    expect(second.wait().status).toBe('wait');

    vi.useRealTimers();
  });

  /**
   * @example
   * const first = await debounce(ctx, { lane: 'user-feedback', ms: 1000 });
   * vi.setSystemTime(1800);
   * const second = await debounce(ctx, { lane: 'user-feedback', ms: 1000 });
   * vi.setSystemTime(2600);
   * const third = await debounce(ctx, { lane: 'user-feedback', ms: 1000 });
   * vi.setSystemTime(3601);
   * const fourth = await debounce(ctx, { lane: 'user-feedback', ms: 1000 });
   *
   * expect(second.delayMs).toBe(1000);
   * expect(third.delayMs).toBe(1000);
   * expect(fourth.ok).toBe(true);
   */
  it('extends the debounce quiet window after each incoming event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const ctx = createRuntimeProcessorContext({
      backend: createRuntimeBackend(),
      scopeKey: 'topic:topic-1',
    });

    const first = await debounce(ctx, { lane: 'user-feedback', ms: 1_000 });

    vi.setSystemTime(1_800);

    const second = await debounce(ctx, { lane: 'user-feedback', ms: 1_000 });

    vi.setSystemTime(2_600);

    const third = await debounce(ctx, { lane: 'user-feedback', ms: 1_000 });

    vi.setSystemTime(3_601);

    const fourth = await debounce(ctx, { lane: 'user-feedback', ms: 1_000 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.delayMs).toBe(1_000);
    expect(third.ok).toBe(false);
    expect(third.delayMs).toBe(1_000);
    expect(fourth.ok).toBe(true);

    vi.useRealTimers();
  });

  /**
   * @example
   * const first = await throttle(ctx, { lane: 'memory-write', ms: 500 });
   * const second = await throttle(ctx, { lane: 'memory-write', ms: 500 });
   *
   * expect(first.ok).toBe(true);
   * expect(second.reason).toBe('throttled');
   */
  it('keeps throttle state scoped to one runtime scope key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);

    const backend = createRuntimeBackend();
    const firstScope = createRuntimeProcessorContext({ backend, scopeKey: 'topic:one' });
    const secondScope = createRuntimeProcessorContext({ backend, scopeKey: 'topic:two' });

    const first = await throttle(firstScope, { lane: 'memory-write', ms: 500 });
    const second = await throttle(firstScope, { lane: 'memory-write', ms: 500 });
    const isolated = await throttle(secondScope, { lane: 'memory-write', ms: 500 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('throttled');
    expect(isolated.ok).toBe(true);

    vi.useRealTimers();
  });

  /**
   * @example
   * const timeout = await outerTimeout(ctx, { lane: 'user-feedback', ms: 1000 });
   * const debounceCheck = await debounce(ctx, { lane: 'user-feedback', ms: 1500 });
   * const throttleCheck = await throttle(ctx, { lane: 'user-feedback', ms: 500 });
   *
   * expect(timeout.ok).toBe(true);
   * expect(debounceCheck.ok).toBe(true);
   * expect(throttleCheck.ok).toBe(true);
   */
  it('keeps timeout, debounce, and throttle state isolated for one outward lane', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000);

    const ctx = createRuntimeProcessorContext({
      backend: createRuntimeBackend(),
      scopeKey: 'topic:topic-1',
    });

    const timeout = await outerTimeout(ctx, { lane: 'user-feedback', ms: 15 * 60 * 1000 });
    const debounceCheck = await debounce(ctx, { lane: 'user-feedback', ms: 1_500 });
    const throttleCheck = await throttle(ctx, { lane: 'user-feedback', ms: 500 });

    expect(timeout.ok).toBe(true);
    expect(debounceCheck.ok).toBe(true);
    expect(throttleCheck.ok).toBe(true);

    vi.useRealTimers();
  });

  /**
   * @example
   * const first = await outerTimeout(ctx, { lane: 'workflow', ms: 1000 });
   * vi.setSystemTime(6500);
   * const second = await outerTimeout(ctx, { lane: 'workflow', ms: 1000 });
   *
   * expect(second.wait().status).toBe('conclude');
   */
  it('concludes once the outer timeout window has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);

    const ctx = createRuntimeProcessorContext({
      backend: createRuntimeBackend(),
      scopeKey: 'topic:topic-1',
    });

    const first = await outerTimeout(ctx, { lane: 'workflow', ms: 1_000 });

    vi.setSystemTime(6_500);

    const second = await outerTimeout(ctx, { lane: 'workflow', ms: 1_000 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('timed_out');
    expect(second.wait().status).toBe('conclude');

    vi.useRealTimers();
  });
});
