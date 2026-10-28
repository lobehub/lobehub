// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { BOT_WAKE_ROLLOUT_CACHE_MS, createBotWakeRolloutProbe } from '../botWake/rollout';

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
}));

const clock = () => {
  let at = 1_000;

  return { advance: (ms: number) => (at += ms), now: () => at };
};

describe('bot-wake rollout probe', () => {
  it('is on only for an explicit yes', async () => {
    for (const [value, expected] of [
      [true, true],
      [false, false],
      [undefined, false],
    ] as const) {
      const probe = createBotWakeRolloutProbe('owner', { read: async () => value });

      expect(await probe()).toBe(expected);
    }
  });

  it('fails closed when the flag cannot be read, so the bot keeps its previous behaviour', async () => {
    const probe = createBotWakeRolloutProbe('owner', {
      read: async () => {
        throw new Error('redis down');
      },
    });

    expect(await probe()).toBe(false);
  });

  it('asks for the bot owner’s flag', async () => {
    const read = vi.fn(async () => true);

    await createBotWakeRolloutProbe('owner-7', { read })();

    expect(read).toHaveBeenCalledWith('owner-7');
  });

  it('reuses one answer within the window and shares an in-flight read', async () => {
    const time = clock();
    const read = vi.fn(async () => true);
    const probe = createBotWakeRolloutProbe('owner', { now: time.now, read });

    await Promise.all([probe(), probe(), probe()]);
    time.advance(BOT_WAKE_ROLLOUT_CACHE_MS - 1);
    await probe();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('picks up a flag that was switched off once the window has passed', async () => {
    const time = clock();
    let value = true;
    const probe = createBotWakeRolloutProbe('owner', { now: time.now, read: async () => value });

    expect(await probe()).toBe(true);
    value = false;
    expect(await probe()).toBe(true);
    time.advance(BOT_WAKE_ROLLOUT_CACHE_MS + 1);

    expect(await probe()).toBe(false);
  });

  it('does not keep asking while the flag store is down', async () => {
    const time = clock();
    const read = vi.fn(async () => {
      throw new Error('redis down');
    });
    const probe = createBotWakeRolloutProbe('owner', { now: time.now, read });

    await probe();
    await probe();

    expect(read).toHaveBeenCalledTimes(1);
  });
});
