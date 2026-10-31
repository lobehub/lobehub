import { describe, expect, it } from 'vitest';

import {
  benchmarkDatasetsOf,
  caseCountOf,
  customDatasetsOf,
  datasetsOf,
  describeSettings,
  experimentPartMeta,
  experimentPartsOf,
  getCaseConnectors,
  getCaseIndex,
  getCaseTitle,
  isFullRun,
  isLobeBenchMeta,
  isViewDataset,
  libraryOf,
  looseDatasetsOf,
  nativeCaseId,
  orderDatasetsForPicker,
  pickDefaultDataset,
  rankableSetsOf,
  runCaseCount,
  runCoversSet,
  runStats,
  sameContender,
  settingsBenchmarkOf,
  sortBenchmarks,
  stableJson,
  summarizeCaseResult,
} from '@/features/LobeBench/lobeBench';

describe('lobeBench helpers', () => {
  it('recognises a Lobe Bench experiment by its metadata', () => {
    expect(isLobeBenchMeta({ contenders: [], datasetId: 'ds', k: 1, kind: 'lobe-bench' })).toBe(
      true,
    );
    expect(isLobeBenchMeta({ kind: 'lobe-bench' })).toBe(false);
    expect(isLobeBenchMeta(null)).toBe(false);
  });

  it('describes a contender by the settings that differ from the model default', () => {
    expect(describeSettings()).toBe('');
    expect(describeSettings({ temperature: 0.2 }, { reasoningEffort: 'high' })).toBe(
      'temperature 0.2 · reasoning high',
    );
    // Every setting that tells contenders apart shows, so default names differ.
    expect(
      describeSettings(
        { presence_penalty: 0.5 },
        {
          enableReasoning: false,
          textVerbosity: 'low',
          thinking: 'enabled',
          thinkingLevel: 'high',
        },
      ),
    ).toBe(
      'presence penalty 0.5 · reasoning off · thinking enabled · thinking level high · verbosity low',
    );
  });

  it('writes equal settings as equal text, whatever the key order', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: undefined } })).toBe(stableJson({ a: { d: 2 }, b: 1 }));
    expect(
      sameContender(
        { id: '1', model: 'm', name: 'x', params: { temperature: 0.2, top_p: 1 }, provider: 'p' },
        { id: '2', model: 'm', name: 'y', params: { top_p: 1, temperature: 0.2 }, provider: 'p' },
      ),
    ).toBe(true);
  });

  it('reads a case title, index and connectors from an imported case', () => {
    const testCase = {
      content: {
        environment: { mock: { services: ['twitter', 'lobe-skills', 'lobe-web-browsing'] } },
        input: 'Generate an X daily brief\nfrom recent posts',
      },
      id: 'tc_1',
      metadata: { index: 7, title: 'Generate an X daily brief from recent posts' },
      sortOrder: 6,
    };
    expect(getCaseTitle(testCase)).toBe('Generate an X daily brief from recent posts');
    expect(getCaseTitle({ ...testCase, metadata: null })).toBe('Generate an X daily brief');
    expect(getCaseIndex(testCase)).toBe(7);
    expect(getCaseIndex({ ...testCase, metadata: null })).toBe(7);
    expect(getCaseConnectors(testCase)).toEqual(['twitter', 'lobe-web-browsing']);
  });

  it('summarises a single attempt and a pass@k attempt the same way', () => {
    const single = summarizeCaseResult(
      {
        evalResult: { rubricScores: [{ reason: 'ok', rubricId: 'r', score: 1 }], toolCalls: 3 },
        status: 'passed',
        testCaseId: 'tc',
        topicId: 'tpc',
      },
      1,
    );
    expect(single).toMatchObject({
      passCount: 1,
      reason: 'ok',
      toolCalls: 3,
      total: 1,
      verdict: 'passed',
    });

    const multi = summarizeCaseResult(
      {
        evalResult: {
          threads: [
            { passed: true, status: 'passed', threadId: 'a' },
            { passed: false, status: 'failed', threadId: 'b' },
            { passed: false, status: 'error', threadId: 'c' },
          ],
        },
        status: 'passed',
        testCaseId: 'tc',
        topicId: 'tpc',
      },
      3,
    );
    expect(multi.passCount).toBe(1);
    expect(multi.total).toBe(3);
    expect(multi.threads.map((thread) => thread.status)).toEqual(['passed', 'failed', 'error']);

    expect(summarizeCaseResult(undefined, 3)).toMatchObject({
      passCount: 0,
      total: 3,
      verdict: 'pending',
    });
  });

  it('shows externally completed threads as pass/fail only when a verdict was reported', () => {
    const result = summarizeCaseResult(
      {
        testCaseId: 'tc',
        topicId: 'topic',
        status: 'passed',
        evalResult: {
          threads: [
            { threadId: 'passed', status: 'completed', passed: true },
            { threadId: 'failed', status: 'completed', passed: false },
            { threadId: 'ungraded', status: 'completed' },
          ],
        },
      },
      3,
    );
    expect(result.threads.map((thread) => thread.status)).toEqual(['passed', 'failed', 'pending']);
    expect(result.passCount).toBe(1);
  });

  it('derives a contender row from run metrics', () => {
    const stats = runStats({
      id: 'run',
      metrics: {
        completedCases: 30,
        errorCases: 2,
        failedCases: 10,
        passedCases: 18,
        perCaseCost: 0.02,
        totalCases: 30,
        totalCost: 0.6,
        totalDuration: 3_600_000,
      },
      status: 'completed',
    } as any);
    expect(stats).toMatchObject({
      active: false,
      completed: 30,
      errors: 2,
      passed: 18,
      perCaseCost: 0.02,
      totalCost: 0.6,
    });
    expect(stats.passRate).toBeCloseTo(0.6);
    expect(stats.avgMinutes).toBeCloseTo(2);
    expect(runStats(undefined, 30)).toMatchObject({ passed: 0, total: 30 });
  });

  it('counts a case as passed only when every attempt passed once k > 1', () => {
    const stats = runStats({
      config: { k: 3 },
      id: 'run',
      metrics: {
        completedCases: 30,
        failedCases: 1,
        passAllK: 0.6,
        passAtK: 29 / 30,
        passedCases: 29,
        totalCases: 30,
      },
      status: 'completed',
    } as any);
    expect(stats).toMatchObject({ allK: 18, anyK: 29, k: 3, passed: 18, total: 30 });
    expect(stats.passRate).toBeCloseTo(0.6);
    // A single attempt per case: the three numbers coincide.
    expect(
      runStats({
        config: { k: 1 },
        id: 'run',
        metrics: { passedCases: 25, totalCases: 30 },
        status: 'completed',
      } as any),
    ).toMatchObject({ allK: 25, anyK: 25, k: 1, passed: 25 });
  });
});

describe('case sets', () => {
  const benchmarks = [
    { id: 'b-sample', identifier: 'lobe-bench-sample' },
    { id: 'b-main', identifier: 'lobe-bench' },
  ];
  const datasets = [
    {
      benchmarkId: 'b-main',
      createdAt: '2026-10-25',
      id: 'mine',
      metadata: { custom: true },
      name: 'My cases',
      testCaseCount: 2,
    },
    {
      benchmarkId: 'b-main',
      createdAt: '2026-10-23',
      id: 'b30',
      metadata: { release: 'v26' },
      name: 'Benchmark 30',
      testCaseCount: 30,
    },
    {
      benchmarkId: 'b-sample',
      createdAt: '2026-10-22',
      id: 'date',
      metadata: null,
      name: 'Date check',
      testCaseCount: 1,
    },
    {
      benchmarkId: 'b-sample',
      createdAt: '2026-10-21',
      id: 'sample',
      metadata: null,
      name: 'Persona sample',
      testCaseCount: 3,
    },
    {
      benchmarkId: 'b-main',
      createdAt: '2026-11-01',
      id: 'extra',
      metadata: null,
      name: 'Extra cases',
      testCaseCount: 4,
    },
  ];

  it("lists a benchmark's sets in creation order with the account's own last", () => {
    expect(datasetsOf(datasets, 'b-main').map((d) => d.id)).toEqual(['b30', 'extra', 'mine']);
    expect(customDatasetsOf(datasets, 'b-main').map((d) => d.id)).toEqual(['mine']);
    expect(pickDefaultDataset(datasets, 'b-main')?.id).toBe('b30');
    expect(pickDefaultDataset(datasets, 'b-sample')?.id).toBe('sample');
    expect(pickDefaultDataset([datasets[0]], 'b-main')?.id).toBe('mine');
  });

  it("orders a picker by benchmark (primary first), then each benchmark's sets", () => {
    expect(orderDatasetsForPicker(datasets, benchmarks).map((d) => d.id)).toEqual([
      'b30',
      'extra',
      'mine',
      'sample',
      'date',
    ]);
  });

  it('finds the built-in library and never takes an account dataset for it', () => {
    expect(libraryOf(datasets, 'b-main')?.id).toBe('b30');
    expect(libraryOf([datasets[0]], 'b-main')).toBeUndefined();
  });

  it('counts a dataset by the cases it holds', () => {
    const own = {
      benchmarkId: 'b-main',
      createdAt: '2026-10-30',
      id: 'finance',
      metadata: { custom: true },
      name: 'Finance',
      testCaseCount: 3,
    };
    expect(caseCountOf(own)).toBe(3);
    expect(caseCountOf(datasets[0])).toBe(2);
    expect(caseCountOf(undefined)).toBe(0);
    // An account dataset, listed with the account's own, never as the library.
    expect(customDatasetsOf([...datasets, own], 'b-main').map((d) => d.id)).toEqual([
      'mine',
      'finance',
    ]);
  });
});

describe('datasets that hold their cases', () => {
  const library = {
    benchmarkId: 'b',
    createdAt: '2026-10-01',
    id: 'lib',
    metadata: {},
    name: 'Case library',
  };
  const hard = {
    benchmarkId: 'h',
    createdAt: '2026-10-30',
    id: 'hard',
    metadata: { release: 'hard-v1', view: { id: 'lobe-bench-hard-50', version: 'hard-v1' } },
    name: 'Hard 50',
  };
  const mine = {
    benchmarkId: 'b',
    createdAt: '2026-10-31',
    id: 'mine',
    metadata: { custom: true },
    name: 'Mine',
  };

  const benchmarks = [
    {
      createdAt: '2026-10-30',
      id: 'h',
      identifier: 'lobe-bench-hard-50',
      isSystem: true,
      metadata: { kind: 'lobe-bench', view: { id: 'lobe-bench-hard-50', version: 'v2' } },
      name: 'Lobe Bench Hard 50',
    },
    {
      createdAt: '2026-10-01',
      id: 'b',
      identifier: 'lobe-bench',
      isSystem: true,
      metadata: { kind: 'lobe-bench' },
      name: 'Lobe Bench',
    },
  ];
  const [hardBenchmark, libraryBenchmark] = benchmarks;
  const accountBenchmark = {
    createdAt: '2026-10-31',
    id: 'u',
    identifier: 'lobe-bench-u',
    isSystem: false,
    metadata: { kind: 'lobe-bench' },
    name: 'Finance',
  };

  it('keeps the library apart from Hard 50 and the account datasets', () => {
    const all = [hard, mine, library];
    expect(libraryOf(all, 'b')?.id).toBe('lib');
    expect(libraryOf(all)?.id).toBe('lib');
    expect(isViewDataset(hard)).toBe(true);
    expect(isViewDataset(mine)).toBe(false);
    expect(isViewDataset(library)).toBe(false);
  });

  it('makes each benchmark of its built-in dataset; account datasets belong to none', () => {
    const all = [hard, mine, library];
    expect(benchmarkDatasetsOf(all, libraryBenchmark).map((d) => d.id)).toEqual(['lib']);
    expect(benchmarkDatasetsOf(all, hardBenchmark).map((d) => d.id)).toEqual(['hard']);
    expect(sortBenchmarks(benchmarks).map((b) => b.id)).toEqual(['b', 'h']);
    // Built-in benchmarks come before the account's, whatever their age.
    expect(
      sortBenchmarks([{ ...accountBenchmark, createdAt: '2026-10-01' }, hardBenchmark]).map(
        (b) => b.id,
      ),
    ).toEqual(['h', 'u']);
    // Without the library's benchmark in the list, the oldest still comes first.
    expect(sortBenchmarks([accountBenchmark, hardBenchmark]).map((b) => b.id)).toEqual(['h', 'u']);
    // One leaderboard per benchmark, named by it, on the dataset it is made of.
    expect(rankableSetsOf(sortBenchmarks(benchmarks), all)).toEqual([
      { benchmarkId: 'b', caseVersion: undefined, id: 'lib', name: 'Lobe Bench' },
      { benchmarkId: 'h', caseVersion: 'hard-v1', id: 'hard', name: 'Lobe Bench Hard 50' },
    ]);
  });

  it('takes the settings of a benchmark made of library cases from the library', () => {
    expect(settingsBenchmarkOf(benchmarks, 'h')?.id).toBe('b');
    expect(settingsBenchmarkOf(benchmarks, 'b')?.id).toBe('b');
  });

  it('makes an account benchmark of the datasets moved into it', () => {
    const second = { ...mine, id: 'mine-2', name: 'Mine 2' };
    const moved = { ...mine, benchmarkId: 'u' };
    const all = [hard, moved, { ...second, benchmarkId: 'u' }, library];
    const withAccount = [...sortBenchmarks(benchmarks), accountBenchmark];
    expect(benchmarkDatasetsOf(all, accountBenchmark).map((d) => d.id)).toEqual(['mine', 'mine-2']);
    // In a benchmark of the account's, so no longer loose; the other one still is.
    expect(looseDatasetsOf(all, withAccount)).toEqual([]);
    expect(looseDatasetsOf([hard, mine, library], withAccount).map((d) => d.id)).toEqual(['mine']);
    // Several datasets: one leaderboard each, named by benchmark and dataset.
    expect(
      rankableSetsOf(withAccount, all)
        .filter((set) => set.benchmarkId === 'u')
        .map((set) => set.name),
    ).toEqual(['Finance · Mine', 'Finance · Mine 2']);
    // Its experiment defaults are the library benchmark's.
    expect(settingsBenchmarkOf(withAccount, 'u')?.id).toBe('b');
  });

  it('counts a run for a set when it ran all of that dataset', () => {
    const on = (datasetId: string, caseIds?: string[]) => ({
      config: caseIds ? { caseSelection: { caseIds, mode: 'include' } } : {},
      datasetId,
    });
    expect(runCoversSet(on('hard'), { id: 'hard' })).toBe(true);
    expect(runCoversSet(on('hard', ['c1']), { id: 'hard' })).toBe(false);
    expect(runCoversSet(on('lib'), { id: 'hard' })).toBe(false);
  });
});

describe('experiments over several benchmarks', () => {
  const meta = {
    contenders: [
      { id: 'c-a', model: 'a', name: 'A', provider: 'p', runId: 'run-a' },
      { id: 'c-b', model: 'b', name: 'B', provider: 'p', runId: 'run-b' },
    ],
    datasetId: 'lib',
    k: 1,
    kind: 'lobe-bench' as const,
    maxSteps: 20,
    timeout: 900_000,
  };

  it('reads an experiment of one dataset as one part', () => {
    expect(experimentPartsOf(meta)).toEqual([
      {
        caseIds: undefined,
        datasetId: 'lib',
        pickedDatasetId: undefined,
        runIds: { 'c-a': 'run-a', 'c-b': 'run-b' },
      },
    ]);
    expect(experimentPartMeta(meta, experimentPartsOf(meta)[0]).contenders).toEqual(
      meta.contenders,
    );
  });

  it('shows each part as an experiment of that dataset alone', () => {
    const parts = [
      { benchmarkId: 'b', datasetId: 'lib', runIds: { 'c-a': 'run-a', 'c-b': 'run-b' } },
      {
        benchmarkId: 'h',
        caseIds: ['c1', 'c2'],
        datasetId: 'lib',
        pickedDatasetId: 'hard',
        runIds: { 'c-a': 'run-a2', 'c-b': 'run-b2' },
      },
    ];
    const both = { ...meta, parts };
    expect(experimentPartsOf(both)).toBe(parts);
    const hard = experimentPartMeta(both, parts[1]);
    expect(hard).toMatchObject({
      caseIds: ['c1', 'c2'],
      datasetId: 'lib',
      pickedDatasetId: 'hard',
    });
    expect(hard.contenders.map((c) => c.runId)).toEqual(['run-a2', 'run-b2']);
  });
});

describe('case selection', () => {
  it('selects a case by its dataset-native id, else its primary key', () => {
    expect(nativeCaseId({ id: 'case_1', metadata: { caseId: 'designed-gap-01' } })).toBe(
      'designed-gap-01',
    );
    expect(nativeCaseId({ id: 'case_2', metadata: { caseId: '' } })).toBe('case_2');
    expect(nativeCaseId({ id: 'case_3' })).toBe('case_3');
  });

  it('tells whole-set runs from runs that picked cases, and counts their cases', () => {
    const whole = { config: { caseSelection: undefined } };
    const all = { config: { caseSelection: { mode: 'all' as const } } };
    const some = { config: { caseSelection: { caseIds: ['a', 'b'], mode: 'include' as const } } };
    const most = { config: { caseSelection: { caseIds: ['a'], mode: 'exclude' as const } } };
    expect([whole, all, some, most].map(isFullRun)).toEqual([true, true, false, false]);
    expect([whole, all, some, most].map((run) => runCaseCount(run, 30))).toEqual([30, 30, 2, 29]);
  });
});
