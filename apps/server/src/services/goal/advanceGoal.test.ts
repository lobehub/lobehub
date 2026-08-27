import type { GoalTickOutcome, GoalTickResult } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ tick: vi.fn() }));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('./index', () => ({ GoalService: vi.fn(() => ({ tick: mocks.tick })) }));

const { advanceGoal, MAX_TICKS_PER_ADVANCE } = await import('./advanceGoal');

const tickResult = (outcome: GoalTickOutcome): GoalTickResult => ({
  goalId: 'goal-1',
  message: outcome,
  outcome,
});

const advance = () => advanceGoal({ goalId: 'goal-1', userId: 'user-1' });

describe('advanceGoal', () => {
  beforeEach(() => mocks.tick.mockReset());

  it('keeps ticking while the coordinator reports progress', async () => {
    mocks.tick
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('achieved'));

    const { result, ticks } = await advance();

    expect(ticks).toBe(3);
    expect(result.outcome).toBe('achieved');
  });

  it('hands off at waiting_external instead of polling a running task', async () => {
    // The Work Task's own settle queues the next advance. Polling here would
    // hold a worker open for the whole execution and duplicate that event.
    mocks.tick
      .mockResolvedValueOnce(tickResult('advanced'))
      .mockResolvedValueOnce(tickResult('waiting_external'));

    const { result, ticks } = await advance();

    expect(ticks).toBe(2);
    expect(result.outcome).toBe('waiting_external');
    expect(mocks.tick).toHaveBeenCalledTimes(2);
  });

  it.each(['achieved', 'failed', 'no_progress', 'waiting_human'] as const)(
    'stops on %s without another tick',
    async (outcome) => {
      mocks.tick.mockResolvedValue(tickResult(outcome));

      const { result } = await advance();

      expect(mocks.tick).toHaveBeenCalledTimes(1);
      expect(result.outcome).toBe(outcome);
    },
  );

  it('gives up at the per-advance limit rather than looping forever', async () => {
    mocks.tick.mockResolvedValue(tickResult('advanced'));

    const { ticks } = await advance();

    expect(ticks).toBe(MAX_TICKS_PER_ADVANCE);
    expect(mocks.tick).toHaveBeenCalledTimes(MAX_TICKS_PER_ADVANCE);
  });

  it('runs as the goal owner, not as the caller', async () => {
    const { GoalService } = await import('./index');
    mocks.tick.mockResolvedValue(tickResult('no_progress'));

    await advanceGoal({ goalId: 'goal-1', userId: 'owner-9', workspaceId: 'ws-3' });

    expect(GoalService).toHaveBeenCalledWith(expect.anything(), 'owner-9', 'ws-3');
  });
});
