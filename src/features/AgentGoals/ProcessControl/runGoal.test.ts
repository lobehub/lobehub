import type { GoalTickResult } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { MAX_TICKS_PER_RUN, runGoal } from './runGoal';

const tickResult = (outcome: GoalTickResult['outcome']): GoalTickResult => ({
  goalId: 'goal-1',
  message: outcome,
  outcome,
});

const noSleep = () => Promise.resolve();

describe('runGoal', () => {
  it('keeps advancing while the coordinator reports progress', async () => {
    const tick = vi
      .fn()
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('achieved'));

    const { result, ticks } = await runGoal({ sleep: noSleep, tick });

    expect(ticks).toBe(3);
    expect(result.outcome).toBe('achieved');
  });

  it('waits out a running task instead of stopping on it', async () => {
    // `waiting_external` means a dispatched task is still executing — reporting
    // it as a stop is what made one press look like it did nothing.
    const sleep = vi.fn().mockResolvedValue(undefined);
    const tick = vi
      .fn()
      .mockResolvedValueOnce(tickResult('waiting_external'))
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('achieved'));

    await runGoal({ sleep, tick });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it.each(['achieved', 'failed', 'no_progress', 'waiting_human'] as const)(
    'stops on %s without another tick',
    async (outcome) => {
      const tick = vi.fn().mockResolvedValue(tickResult(outcome));

      const { result } = await runGoal({ sleep: noSleep, tick });

      expect(tick).toHaveBeenCalledTimes(1);
      expect(result.outcome).toBe(outcome);
    },
  );

  it('gives up after the safety limit rather than looping forever', async () => {
    const tick = vi.fn().mockResolvedValue(tickResult('advanced'));

    const { ticks } = await runGoal({ sleep: noSleep, tick });

    expect(ticks).toBe(MAX_TICKS_PER_RUN);
    expect(tick).toHaveBeenCalledTimes(MAX_TICKS_PER_RUN);
  });

  it('reports every step so the surface can follow along', async () => {
    const onProgress = vi.fn();
    const tick = vi
      .fn()
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('waiting_human'));

    await runGoal({ onProgress, sleep: noSleep, tick });

    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: 'advanced' }),
      1,
    );
    expect(onProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ outcome: 'waiting_human' }),
      2,
    );
  });
});
