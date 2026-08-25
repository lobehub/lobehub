import { describe, expect, it } from 'vitest';

import { getGoalPresentation } from './goalPresentation';

describe('getGoalPresentation', () => {
  it('maps the goal lifecycle state to the goal list vocabulary', () => {
    expect(
      getGoalPresentation({
        checks: [{ state: 'passed' }, { state: 'failed' }, { state: 'passed' }],
        goalStatus: 'verifying',
        rounds: 2,
      }),
    ).toMatchObject({
      passed: 2,
      progress: 67,
      statusKey: 'goalList.status.verifying',
      total: 3,
    });
  });

  it('shows achieved only when the goal state machine reached it', () => {
    expect(
      getGoalPresentation({
        checks: [{ state: 'passed' }],
        goalStatus: 'achieved',
        rounds: 3,
      }).statusKey,
    ).toBe('goalList.status.achieved');
  });

  it('reports rounds and budget without any checks yet', () => {
    expect(getGoalPresentation({ goalStatus: 'running', maxRounds: 5, rounds: 2 })).toMatchObject({
      maxRounds: 5,
      passed: 0,
      progress: 0,
      rounds: 2,
      statusKey: 'goalList.status.running',
      total: 0,
    });
  });

  it('maps every goal status to a goal list key', () => {
    const cases: Array<[Parameters<typeof getGoalPresentation>[0]['goalStatus'], string]> = [
      ['planning', 'goalList.status.planning'],
      ['running', 'goalList.status.running'],
      ['verifying', 'goalList.status.verifying'],
      ['review', 'goalList.status.review'],
      ['paused', 'goalList.status.paused'],
      ['achieved', 'goalList.status.achieved'],
      ['failed', 'goalList.status.error'],
      ['canceled', 'goalList.status.canceled'],
    ];

    for (const [goalStatus, statusKey] of cases) {
      expect(getGoalPresentation({ goalStatus, rounds: 0 }).statusKey).toBe(statusKey);
    }
  });
});
