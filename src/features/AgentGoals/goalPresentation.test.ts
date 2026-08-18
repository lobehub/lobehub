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

  it('keeps an executing round shown as running while the verify plan is only planned', () => {
    // Regression (caught by the E2E acceptance run): the verify plan is
    // confirmed at run start, so the acceptance phase reads `planned` for the
    // whole executing round. That phase must fall through to the goal entity
    // status (`running`) instead of rendering 验证中.
    expect(
      getGoalPresentation({
        acceptanceStatus: 'planned',
        goalStatus: 'running',
        rounds: 1,
        taskStatus: 'running',
      }).statusKey,
    ).toBe('goalList.status.running');
  });

  it('prefers the goal entity status over the task-status heuristic', () => {
    expect(
      getGoalPresentation({ goalStatus: 'paused', rounds: 1, taskStatus: 'running' }).statusKey,
    ).toBe('goalList.status.paused');
  });
});
