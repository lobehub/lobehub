import { describe, expect, it } from 'vitest';

import { getGoalTaskProgress } from './goalTaskProgress';

describe('getGoalTaskProgress', () => {
  it('reports how much of the graph is closed while it runs', () => {
    expect(
      getGoalTaskProgress({ criteriaCount: 4, status: 'running', taskDone: 2, taskTotal: 3 }),
    ).toEqual({ passed: 2, phase: 'running', progress: 67, total: 3 });
  });

  it('falls back to the drafted criteria count before the graph is seeded', () => {
    expect(getGoalTaskProgress({ criteriaCount: 4, status: 'planning' })).toEqual({
      passed: 0,
      phase: 'planning',
      progress: 0,
      total: 4,
    });
  });

  it('reads a running goal without any Task yet as planning', () => {
    // `/goal` from a conversation adopts that run as the first planning turn and
    // marks the goal running before the plan lands its Tasks.
    expect(getGoalTaskProgress({ criteriaCount: 2, status: 'running', taskTotal: 0 }).phase).toBe(
      'planning',
    );
  });

  it('lets a waiting decision gate outrank the goal status', () => {
    // A goal keeps its `running` row while a gate is open; the card must still
    // read as blocked on the user, not as work in progress.
    expect(
      getGoalTaskProgress({ criteriaCount: 1, pendingDecisions: 1, status: 'running' }).phase,
    ).toBe('waiting');
  });

  it.each([
    ['achieved', 'achieved'],
    ['canceled', 'canceled'],
    ['failed', 'error'],
    ['paused', 'paused'],
    ['review', 'review'],
    ['verifying', 'verifying'],
  ] as const)('maps goal status %s to phase %s', (status, phase) => {
    expect(getGoalTaskProgress({ criteriaCount: 1, status }).phase).toBe(phase);
  });
});
