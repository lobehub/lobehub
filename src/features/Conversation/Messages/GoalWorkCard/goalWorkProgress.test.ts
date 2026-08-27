import { describe, expect, it } from 'vitest';

import { getGoalWorkProgress } from './goalWorkProgress';

describe('getGoalWorkProgress', () => {
  it('reports how much of the graph is closed while it runs', () => {
    expect(
      getGoalWorkProgress({ criteriaCount: 4, status: 'running', workDone: 2, workTotal: 3 }),
    ).toEqual({ passed: 2, phase: 'running', progress: 67, total: 3 });
  });

  it('falls back to the drafted criteria count before the graph is seeded', () => {
    expect(getGoalWorkProgress({ criteriaCount: 4, status: 'planning' })).toEqual({
      passed: 0,
      phase: 'running',
      progress: 0,
      total: 4,
    });
  });

  it('lets a waiting decision gate outrank the goal status', () => {
    // A goal keeps its `running` row while a gate is open; the card must still
    // read as blocked on the user, not as work in progress.
    expect(
      getGoalWorkProgress({ criteriaCount: 1, pendingDecisions: 1, status: 'running' }).phase,
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
    expect(getGoalWorkProgress({ criteriaCount: 1, status }).phase).toBe(phase);
  });
});
