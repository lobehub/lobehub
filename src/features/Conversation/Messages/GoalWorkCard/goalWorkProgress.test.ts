import { describe, expect, it } from 'vitest';

import { getGoalWorkProgress } from './goalWorkProgress';

describe('getGoalWorkProgress', () => {
  it('keeps a planned acceptance in execution while its task is running', () => {
    expect(
      getGoalWorkProgress({
        acceptanceStatus: 'planned',
        criteriaCount: 4,
        maxRounds: 3,
        rounds: 1,
        taskStatus: 'running',
      }),
    ).toEqual({
      maxRounds: 3,
      passed: 0,
      phase: 'running',
      progress: 0,
      round: 1,
      total: 4,
    });
  });

  it('reports the verification phase and real acceptance coverage', () => {
    expect(
      getGoalWorkProgress({
        acceptanceStatus: 'verifying',
        checks: [{ state: 'passed' }, { state: 'running' }, { state: 'passed' }],
        criteriaCount: 3,
        maxRounds: 3,
        rounds: 2,
        taskStatus: 'running',
      }),
    ).toEqual({
      maxRounds: 3,
      passed: 2,
      phase: 'verifying',
      progress: 67,
      round: 2,
      total: 3,
    });
  });

  it.each([
    ['repairing', 'repairing'],
    ['delivered', 'review'],
    ['accepted', 'achieved'],
    ['errored', 'error'],
  ])('maps acceptance status %s to phase %s', (acceptanceStatus, phase) => {
    expect(
      getGoalWorkProgress({ acceptanceStatus, criteriaCount: 1, taskStatus: 'running' }).phase,
    ).toBe(phase);
  });
});
