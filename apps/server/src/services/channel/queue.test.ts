import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { LocalImpl } = vi.hoisted(() => ({ LocalImpl: class {} }));

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/server/services/queue/impls', () => ({ LocalQueueServiceImpl: LocalImpl }));
vi.mock('@/server/services/queue', () => ({
  QueueService: class {
    getImpl = () => new LocalImpl();
    scheduleMessage = vi.fn();
  },
}));

describe('wakeChannel without QStash', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances the Channel through the runner the coordinator registered', async () => {
    const { registerLocalChannelAdvance, wakeChannel } = await import('./queue');
    const advance = vi.fn().mockResolvedValue(undefined);
    registerLocalChannelAdvance(advance);

    await wakeChannel('chn_000000000001');
    await vi.runOnlyPendingTimersAsync();

    expect(advance).toHaveBeenCalledWith('chn_000000000001');
  });

  it('retries later instead of dropping the wakeup while no runner is registered', async () => {
    const { registerLocalChannelAdvance, wakeChannel } = await import('./queue');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await wakeChannel('chn_000000000002');
    await vi.runOnlyPendingTimersAsync();
    expect(error).toHaveBeenCalled();

    const advance = vi.fn().mockResolvedValue(undefined);
    registerLocalChannelAdvance(advance);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(advance).toHaveBeenCalledWith('chn_000000000002');
    error.mockRestore();
  });
});
