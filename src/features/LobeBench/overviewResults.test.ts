import { describe, expect, it } from 'vitest';

import {
  experimentCaseProgress,
  isExperimentGradingComplete,
  isRunGradingComplete,
  overviewAttention,
  runGradingGap,
} from './overviewResults';

describe('overview grading completeness', () => {
  it('finds legacy grading gaps even when execution marked every case completed', () => {
    const run = {
      status: 'completed',
      metrics: { totalCases: 3, completedCases: 3, passedCases: 1, failedCases: 1 },
    };
    expect(runGradingGap(run)).toEqual({ judgeErrors: 0, external: 0, unaccounted: 1 });
    expect(isRunGradingComplete(run)).toBe(false);
  });

  it('separates Judge faults and external grading without double-counting them as unknown gaps', () => {
    const run = {
      status: 'completed',
      metrics: {
        totalCases: 7,
        passedCases: 1,
        failedCases: 1,
        errorCases: 1,
        timeoutCases: 1,
        judgeErrorCases: 1,
        externalCases: 1,
      },
    };
    expect(runGradingGap(run)).toEqual({ judgeErrors: 1, external: 1, unaccounted: 1 });
    expect(isRunGradingComplete(run)).toBe(false);
  });

  it('uses case counts for K=2 completion, progress, and leaderboard eligibility', () => {
    const run = {
      config: { k: 2 },
      status: 'completed',
      metrics: { totalCases: 3, completedCases: 3, passedCases: 2, failedCases: 1 },
    };
    expect(runGradingGap(run)).toEqual({ judgeErrors: 0, external: 0, unaccounted: 0 });
    expect(experimentCaseProgress([run])).toEqual({ done: 3, total: 3 });
    expect(isRunGradingComplete(run)).toBe(true);
  });

  it('excludes incomplete, external, and Judge-failed runs before selecting leaderboard scores', () => {
    const complete = { status: 'completed', metrics: { totalCases: 2, passedCases: 2 } };
    const pending = { ...complete, status: 'running' };
    const judge = {
      status: 'completed',
      metrics: { totalCases: 2, passedCases: 1, judgeErrorCases: 1 },
    };
    const external = {
      status: 'completed',
      metrics: { totalCases: 2, passedCases: 1, externalCases: 1 },
    };
    const legacy = {
      status: 'completed',
      metrics: { totalCases: 2, passedCases: 1, completedCases: 2 },
    };
    expect([complete, pending, judge, external, legacy].filter(isRunGradingComplete)).toEqual([
      complete,
    ]);
    expect(isExperimentGradingComplete([complete])).toBe(true);
    expect(experimentCaseProgress([complete])).toEqual({ done: 2, total: 2 });
    for (const incomplete of [pending, judge, external, legacy])
      expect(isExperimentGradingComplete([complete, incomplete])).toBe(false);
    expect(isExperimentGradingComplete([])).toBe(false);
  });

  it('keeps gap counts finite and nonnegative with absent or corrupt metrics', () => {
    expect(
      runGradingGap({
        metrics: { totalCases: 2, judgeErrorCases: NaN, externalCases: Infinity, failedCases: -5 },
      }),
    ).toEqual({ judgeErrors: 0, external: 0, unaccounted: 2 });
    expect(runGradingGap({ metrics: { totalCases: 1, passedCases: 4 } }).unaccounted).toBe(0);
    expect(runGradingGap({})).toEqual({ judgeErrors: 0, external: 0, unaccounted: 0 });
  });

  it('offers distinct attention reasons and does not label work still running as a historical grading gap', () => {
    const attention = overviewAttention([
      {
        status: 'completed',
        metrics: { totalCases: 4, errorCases: 1, judgeErrorCases: 1, externalCases: 1 },
      },
      { status: 'running', metrics: { totalCases: 5 } },
    ]);
    expect(attention).toEqual({ errors: 1, judgeErrors: 1, external: 1, unaccounted: 1 });
  });
  it('requires valid execution evidence as well as complete grading counts', () => {
    const complete = {
      status: 'completed',
      metrics: { totalCases: 3, completedCases: 3, passedCases: 2, failedCases: 1 },
    };
    const invalid = [
      { ...complete, metrics: { ...complete.metrics, failedCases: 0, errorCases: 1 } },
      { ...complete, metrics: { ...complete.metrics, failedCases: 0, timeoutCases: 1 } },
      { ...complete, hasUnverifiedAttempts: true, metrics: { ...complete.metrics, errorCases: 0 } },
    ];
    for (const run of invalid) {
      expect(runGradingGap(run).unaccounted).toBe(0);
      expect(experimentCaseProgress([run])).toEqual({ done: 3, total: 3 });
      expect(isRunGradingComplete(run)).toBe(false);
      expect(isExperimentGradingComplete([complete, run])).toBe(false);
    }
    expect(isRunGradingComplete({ ...complete, hasUnverifiedAttempts: false })).toBe(true);
  });
});
