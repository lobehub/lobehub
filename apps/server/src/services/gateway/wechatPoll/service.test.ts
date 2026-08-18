// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runWechatPollService } from './service';

// The service only drives config + the tick; everything heavyweight lives
// behind runWechatPollTick, which these tests replace wholesale.
const tickMock = vi.hoisted(() => ({
  runWechatPollTick: vi.fn(async (_options?: unknown) => ({ role: 'skipped' as const })),
}));
vi.mock('./shardRunner', () => tickMock);

describe('runWechatPollService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WECHAT_POLL_SHARD_COUNT;
  });

  afterEach(() => {
    delete process.env.WECHAT_POLL_SHARD_COUNT;
  });

  it('runs one claim loop per configured shard and stops on abort', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '2';
    const controller = new AbortController();

    let ticks = 0;
    tickMock.runWechatPollTick.mockImplementation(async () => {
      ticks++;
      if (ticks >= 2) controller.abort();
      return { role: 'skipped' as const };
    });

    await runWechatPollService({ idleMs: 5, signal: controller.signal });

    // Both loops got at least one tick in before the abort landed.
    expect(ticks).toBeGreaterThanOrEqual(2);
  });

  it('re-ticks immediately after a worker window but idles after a skip', async () => {
    const controller = new AbortController();
    const roles: string[] = ['worker', 'skipped', 'skipped'];
    const tickAt: number[] = [];

    tickMock.runWechatPollTick.mockImplementation(async () => {
      tickAt.push(Date.now());
      const role = roles.shift();
      if (!role) {
        controller.abort();
        return { role: 'skipped' as const };
      }
      return { role } as never;
    });

    await runWechatPollService({ idleMs: 120, signal: controller.signal });

    // worker → next tick rolls straight in; skipped → one idle period passes.
    expect(tickAt[1] - tickAt[0]).toBeLessThan(100);
    expect(tickAt[2] - tickAt[1]).toBeGreaterThanOrEqual(100);
  });

  it('keeps looping after a tick failure instead of crashing the service', async () => {
    const controller = new AbortController();
    let calls = 0;

    tickMock.runWechatPollTick.mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('redis hiccup');
      controller.abort();
      return { role: 'skipped' as const };
    });

    await expect(
      runWechatPollService({ idleMs: 5, signal: controller.signal }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it('hands the abort signal to workers as their shouldStop hook', async () => {
    const controller = new AbortController();

    let observedShouldStop: (() => boolean) | undefined;
    tickMock.runWechatPollTick.mockImplementation(async (options) => {
      observedShouldStop = (options as { shouldStop: () => boolean }).shouldStop;
      controller.abort();
      return { role: 'skipped' as const };
    });

    await runWechatPollService({ idleMs: 5, signal: controller.signal });

    // In-flight workers watch the same signal, so SIGTERM stops them within
    // one supervision tick rather than at their window deadline.
    expect(observedShouldStop?.()).toBe(true);
  });

  it('resolves promptly when aborted while idling', async () => {
    const controller = new AbortController();
    tickMock.runWechatPollTick.mockResolvedValue({ role: 'skipped' as const });

    const started = Date.now();
    const done = runWechatPollService({ idleMs: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await done;

    expect(Date.now() - started).toBeLessThan(5000);
  });
});
