import type { AgentEvalRunListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  contenderName,
  pickRankedSet,
  rankContenders,
} from '@/features/LobeBench/benchmarkRanking';

let seq = 0;

/** A completed, fully judged run of 30 cases, 3 attempts each, unless overridden. */
const run = (
  over: Partial<Omit<AgentEvalRunListItem, 'metrics' | 'config'>> & {
    config?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    passed?: number;
  } = {},
): AgentEvalRunListItem => {
  const { passed = 20, metrics, config, ...rest } = over;
  seq += 1;
  return {
    createdAt: new Date('2026-10-30T00:00:00Z'),
    datasetId: 'set-a',
    id: `run-${seq}`,
    name: `model-${seq}`,
    status: 'completed',
    updatedAt: new Date('2026-10-30T01:00:00Z'),
    ...rest,
    config: { k: 3, ...config } as AgentEvalRunListItem['config'],
    metrics: {
      averageScore: passed / 30,
      passRate: passed / 30,
      errorCases: 0,
      failedCases: 30 - passed,
      passAllAt: { '3': passed / 30 },
      passAnyAt: { '3': passed / 30 },
      passedCases: passed,
      timeoutCases: 0,
      totalCases: 30,
      ...metrics,
    } as AgentEvalRunListItem['metrics'],
  } as AgentEvalRunListItem;
};

describe('contenderName', () => {
  it('prefers the run name, then the model, then the target Agent', () => {
    expect(contenderName(run({ config: { model: 'm' }, name: 'DeepSeek · high' }))).toBe(
      'DeepSeek · high',
    );
    expect(contenderName(run({ config: { model: 'gpt-6.1' }, name: null }))).toBe('gpt-6.1');
    expect(
      contenderName(run({ name: null, targetAgent: { id: 'agt', title: 'My Agent' } as any })),
    ).toBe('My Agent');
    expect(contenderName(run({ name: null }))).toBe('Unknown');
  });
});

describe('rankContenders', () => {
  it('ranks only runs on the current version of the cases', () => {
    const current = '2026-10-30-realism-v4+realism-v3';
    const set = { caseVersion: current, id: 'set-a' };
    const ranking = rankContenders(
      [
        // Made on the current cases: ranks.
        run({ config: { caseVersion: current }, name: 'DeepSeek', passed: 19 }),
        // A better score on an earlier version (or before runs recorded one) does not.
        run({
          config: { caseVersion: '2026-10-30-realism-v4+realism-v2' },
          name: 'Terra',
          passed: 25,
        }),
        run({ name: 'Terra', passed: 24 }),
      ],
      set,
    );
    expect(ranking.contenders.map((c) => c.name)).toEqual(['DeepSeek']);
    expect(ranking.outdated).toBe(2);
    expect(ranking.ranked).toBe(1);
    // A set without a version (cases the account wrote) ranks every run.
    expect(rankContenders([run({ name: 'X' })], 'set-a').outdated).toBe(0);
  });

  it('ranks each contender by its best judged full run on the set, best first', () => {
    const runs = [
      run({ name: 'B', passed: 12 }),
      run({ name: 'A', passed: 18 }),
      // A's earlier, worse run does not add a second row.
      run({ name: 'A', passed: 9 }),
      // Other sets and picked-case runs say nothing about this set.
      run({ datasetId: 'set-b', name: 'C', passed: 30 }),
      run({
        config: { caseSelection: { caseIds: ['x'], mode: 'include' } },
        name: 'D',
        passed: 30,
      }),
      run({ name: 'E', passed: 30, status: 'aborted' }),
    ];
    const ranking = rankContenders(runs, 'set-a');
    expect(ranking.contenders.map((c) => [c.name, c.passed])).toEqual([
      ['A', 18],
      ['B', 12],
    ]);
    expect(ranking.ranked).toBe(3);
    expect(ranking.active).toBe(0);
    expect(ranking.broken).toBe(0);
    expect(ranking.unjudged).toBe(0);
  });

  it('counts running and unjudged runs instead of ranking them', () => {
    const runs = [
      run({ name: 'A', passed: 18 }),
      run({ metrics: { passedCases: 0, failedCases: 0 }, name: 'B', status: 'running' }),
      run({ name: 'C', status: 'pending' }),
      // Completed, but three cases still wait for the Judge.
      run({ metrics: { failedCases: 7, judgeErrorCases: 3 }, name: 'D', passed: 20 }),
      // Completed, but every case errored (no API key): no evidence about the model.
      run({ metrics: { errorCases: 30, failedCases: 0 }, name: 'E', passed: 0 }),
    ];
    const ranking = rankContenders(runs, 'set-a');
    expect(ranking.contenders.map((c) => c.name)).toEqual(['A']);
    expect(ranking.active).toBe(2);
    expect(ranking.unjudged).toBe(1);
    expect(ranking.broken).toBe(1);
    expect(ranking.ranked).toBe(1);
  });

  it('excludes partially broken runs and historical hidden errors despite saved complete scores', () => {
    const good = run({ name: 'Valid', passed: 12 });
    const ranking = rankContenders(
      [
        good,
        run({ name: 'Partial error', passed: 29, metrics: { errorCases: 1, failedCases: 0 } }),
        run({ name: 'Partial timeout', passed: 29, metrics: { timeoutCases: 1, failedCases: 0 } }),
        run({
          name: 'Legacy mixed error',
          passed: 30,
          hasUnverifiedAttempts: true,
          metrics: { errorCases: 0 },
        }),
      ],
      'set-a',
    );
    expect(ranking.contenders.map((item) => item.run.id)).toEqual([good.id]);
    expect(ranking).toMatchObject({ broken: 3, ranked: 1, unjudged: 0 });
  });

  it('ranks on 3 attempts: a run of 5 by its estimate for 3, one of fewer not at all', () => {
    const runs = [
      // 18/30 passed all 3 attempts, 29/30 at least one.
      run({
        metrics: { passAllAt: { '3': 0.6 }, passAnyAt: { '3': 29 / 30 } },
        name: 'A',
        passed: 29,
      }),
      // Five attempts rank on what three would show, not on all five.
      run({
        config: { k: 5 },
        metrics: { passAllAt: { '3': 0.5, '5': 0.3 }, passAnyAt: { '3': 0.9 } },
        name: 'B',
        passed: 28,
      }),
      // One attempt cannot say how three would go.
      run({ config: { k: 1 }, name: 'C', passed: 30 }),
    ];
    const ranking = rankContenders(runs, 'set-a');
    expect(ranking.contenders.map((c) => [c.name, c.passed, c.anyK, c.attempts])).toEqual([
      ['A', 18, 29, 3],
      ['B', 15, 27, 5],
    ]);
    expect(ranking.fewAttempts).toBe(1);
    expect(ranking.ranked).toBe(2);
  });

  it('breaks ties by any-attempt passes, then cost per case, then recency', () => {
    const runs = [
      run({ metrics: { perCaseCost: 0.02 }, name: 'pricier', passed: 18 }),
      run({ metrics: { perCaseCost: 0.01 }, name: 'cheaper', passed: 18 }),
      run({ name: 'older', passed: 18, updatedAt: new Date('2026-10-01T00:00:00Z') }),
      run({ name: 'newer', passed: 18, updatedAt: new Date('2026-10-29T00:00:00Z') }),
      run({ metrics: { passAllAt: { '3': 0.6 }, passAnyAt: { '3': 29 / 30 } }, name: 'anyK 29' }),
      run({ metrics: { passAllAt: { '3': 0.6 }, passAnyAt: { '3': 25 / 30 } }, name: 'anyK 25' }),
    ];
    expect(rankContenders(runs, 'set-a').contenders.map((c) => c.name)).toEqual([
      'anyK 29',
      'anyK 25',
      'cheaper',
      'pricier',
      'newer',
      'older',
    ]);
  });
});

describe('rankContenders by setup, not by name', () => {
  const setup = (over: Record<string, unknown> = {}) => ({
    maxSteps: 20,
    model: 'deepseek/deepseek-v4.1-flash',
    provider: 'openrouter',
    timeout: 900_000,
    ...over,
  });

  it('keeps the same model with another setting apart, even under one name', () => {
    const ranking = rankContenders(
      [
        run({ config: setup(), name: 'DeepSeek', passed: 18 }),
        run({
          config: setup({ chatConfig: { thinkingLevel: 'high' } }),
          name: 'DeepSeek',
          passed: 22,
        }),
        // A bigger step budget is another setup too.
        run({ config: setup({ maxSteps: 40 }), name: 'DeepSeek', passed: 20 }),
      ],
      'set-a',
    );
    expect(ranking.contenders.map((c) => [c.name, c.passed])).toEqual([
      ['DeepSeek (openrouter · thinking level high · 20 steps · 15 min)', 22],
      ['DeepSeek (openrouter · default settings · 40 steps · 15 min)', 20],
      ['DeepSeek (openrouter · default settings · 20 steps · 15 min)', 18],
    ]);
  });

  it('keeps different Judge models and providers as separate comparisons', () => {
    const judgeA = setup({ judgeModel: 'judge-a', judgeProvider: 'provider-one' });
    const runs = [
      run({ config: judgeA, name: 'Same contender', passed: 10 }),
      run({ config: judgeA, name: 'Same contender', passed: 12 }),
      run({
        config: setup({ judgeModel: 'judge-b', judgeProvider: 'provider-one' }),
        name: 'Same contender',
        passed: 20,
      }),
      run({
        config: setup({ judgeModel: 'judge-a', judgeProvider: 'provider-two' }),
        name: 'Same contender',
        passed: 25,
      }),
    ];
    const ranking = rankContenders(runs, 'set-a');
    expect(ranking.contenders.map((item) => item.run.id)).toEqual([
      runs[3].id,
      runs[2].id,
      runs[1].id,
    ]);
    expect(ranking.ranked).toBe(4);
  });

  it('counts one setup once, whatever it was named', () => {
    const ranking = rankContenders(
      [
        run({
          config: setup({ params: { temperature: 0.2, top_p: 0.9 } }),
          name: 'DeepSeek · temperature 0.2',
          passed: 15,
        }),
        run({
          config: setup({ params: { top_p: 0.9, temperature: 0.2 } }),
          name: 'Mine',
          passed: 19,
        }),
      ],
      'set-a',
    );
    expect(ranking.contenders.map((c) => [c.name, c.passed])).toEqual([['Mine', 19]]);
    expect(ranking.ranked).toBe(2);
  });
});

describe('rankContenders on a dataset that holds copies of library cases', () => {
  it('ranks the runs on that dataset of all its cases, not runs on the library', () => {
    const runs = [
      run({ datasetId: 'hard', name: 'A', passed: 2 }),
      // Some of its cases only: not a result on the dataset.
      run({
        config: { caseSelection: { caseIds: ['c1'], mode: 'include' } },
        datasetId: 'hard',
        name: 'B',
      }),
      // A run on the library is the library's, whatever cases it ran.
      run({ datasetId: 'library', name: 'D', passed: 30 }),
    ];
    expect(rankContenders(runs, { id: 'hard' }).contenders.map((c) => c.name)).toEqual(['A']);
    expect(rankContenders(runs, { id: 'library' }).contenders.map((c) => c.name)).toEqual(['D']);
  });
});

describe('pickRankedSet', () => {
  it('picks the set with the most ranked contenders, the first listed on a tie', () => {
    const sets = [{ id: 'published' }, { id: 'mine' }, { id: 'subset' }];
    const rankings = new Map([
      ['published', rankContenders([run({ datasetId: 'published' })], 'published')],
      ['mine', rankContenders([], 'mine')],
      [
        'subset',
        rankContenders(
          [run({ datasetId: 'subset', name: 'A' }), run({ datasetId: 'subset', name: 'B' })],
          'subset',
        ),
      ],
    ]);
    expect(pickRankedSet(sets, rankings)?.id).toBe('subset');
    rankings.set('published', rankings.get('subset')!);
    expect(pickRankedSet(sets, rankings)?.id).toBe('published');
    expect(pickRankedSet([], rankings)).toBeUndefined();
    expect(pickRankedSet(sets, new Map())?.id).toBe('published');
  });
});
