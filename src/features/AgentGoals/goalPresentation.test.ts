import { describe, expect, it } from 'vitest';

import { getGoalPresentation } from './goalPresentation';

describe('getGoalPresentation', () => {
  it('uses Acceptance as the authoritative lifecycle and progress source', () => {
    expect(
      getGoalPresentation({
        acceptanceStatus: 'verifying',
        checks: [{ state: 'passed' }, { state: 'failed' }, { state: 'passed' }],
        rounds: 2,
        taskStatus: 'running',
      }),
    ).toMatchObject({
      passed: 2,
      progress: 67,
      statusKey: 'goalList.status.verifying',
      total: 3,
    });
  });

  it('shows achieved only after Acceptance is accepted', () => {
    expect(
      getGoalPresentation({
        acceptanceStatus: 'accepted',
        checks: [{ state: 'passed' }],
        rounds: 3,
        taskStatus: 'completed',
      }).statusKey,
    ).toBe('goalList.status.achieved');
  });

  it('falls back to task execution and round state before Acceptance exists', () => {
    expect(getGoalPresentation({ maxRounds: 5, rounds: 2, taskStatus: 'scheduled' })).toMatchObject(
      {
        maxRounds: 5,
        passed: 0,
        progress: 0,
        rounds: 2,
        statusKey: 'goalList.status.waiting',
        total: 0,
      },
    );
  });
});
