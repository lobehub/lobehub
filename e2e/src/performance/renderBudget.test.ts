import { describe, expect, it } from 'vitest';

import {
  findBudgetViolations,
  resolveRunnerKind,
  type ScenarioBudget,
  summarizeReports,
} from './renderBudget';
import type { RenderReport } from './renderProfile';

const report = (renders: number, actualDurationMs: number, maxGapMs: number): RenderReport => {
  const region = { actualDurationMs, maxActualDurationMs: 0, mounts: 0, renders, updates: renders };
  return {
    commitCount: renders,
    durationMs: 0,
    frames: { count: 10, maxGapMs },
    label: 'switch',
    longestAnimationFrameMs: 0,
    regions: { conversation: region, messages: region, sidebar: region },
  };
};

const budget = (renders: number, actualDurationMs: number, maxFrameGapMs: number) =>
  ({
    maxFrameGapMs,
    regions: {
      conversation: { actualDurationMs, renders },
      messages: { actualDurationMs, renders },
      sidebar: { actualDurationMs, renders },
    },
  }) satisfies ScenarioBudget;

describe('summarizeReports', () => {
  it('takes the nearest-rank median and keeps the worst sample', () => {
    const summary = summarizeReports([report(3, 10, 20), report(9, 50, 200), report(4, 12, 18)]);

    expect(summary.samples).toBe(3);
    expect(summary.regions.sidebar.renders).toEqual({ max: 9, p50: 4 });
    expect(summary.regions.sidebar.actualDurationMs).toEqual({ max: 50, p50: 12 });
    expect(summary.maxFrameGapMs).toEqual({ max: 200, p50: 20 });
  });

  it('uses the lower middle sample for an even count', () => {
    expect(summarizeReports([report(2, 0, 0), report(6, 0, 0)]).regions.messages.renders.p50).toBe(
      2,
    );
  });
});

describe('findBudgetViolations', () => {
  it('passes a summary at the budget', () => {
    const summary = summarizeReports([report(4, 12, 20)]);

    expect(findBudgetViolations('switchCached', summary, budget(4, 12, 20))).toEqual([]);
  });

  it('names the scenario, region and metric of each overrun', () => {
    const summary = summarizeReports([report(5, 12, 21)]);
    const limits = budget(4, 12, 20);
    limits.regions.messages.renders = 5;
    limits.regions.conversation.renders = 5;

    expect(findBudgetViolations('switchCold', summary, limits)).toEqual([
      'switchCold › sidebar: 5 renders (p50) > budget 4',
      'switchCold › longest frame gap 21ms (p50) > budget 20ms',
    ]);
  });
});

describe('resolveRunnerKind', () => {
  it('selects CI budgets on CI runners', () => {
    expect(resolveRunnerKind({ CI: 'true' })).toBe('ci');
    expect(resolveRunnerKind({})).toBe('local');
  });
});
