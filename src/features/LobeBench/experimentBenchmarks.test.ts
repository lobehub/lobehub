import { describe, expect, it } from 'vitest';

import { benchmarkIdsOfDatasets, benchmarkProtocolOf, datasetIdsOfBenchmarks } from './lobeBench';

const benchmarks = [
  { id: 'evb_hard10', isSystem: false },
  { id: 'evb_lb50', isSystem: false },
];
const datasets = [
  { benchmarkId: 'evb_hard10', id: 'ds_v2', metadata: { custom: true } },
  { benchmarkId: 'evb_hard10', id: 'ds_v3', metadata: { custom: true } },
  { benchmarkId: 'evb_lb50', id: 'ds_lb50', metadata: { custom: true } },
  // The account's picked cases, filed under no benchmark of its own.
  { benchmarkId: null, id: 'ds_loose', metadata: { custom: true } },
];

describe('experiments start on benchmarks only', () => {
  it('runs every dataset a chosen benchmark is made of', () => {
    expect(datasetIdsOfBenchmarks(datasets, benchmarks, ['evb_hard10'])).toEqual([
      'ds_v2',
      'ds_v3',
    ]);
  });

  it('never runs a dataset that is in no benchmark', () => {
    const chosen = benchmarkIdsOfDatasets(datasets, benchmarks, ['ds_loose']);
    expect(chosen).toEqual([]);
    expect(datasetIdsOfBenchmarks(datasets, benchmarks, chosen)).toEqual([]);
  });

  it('turns a preset dataset into its whole benchmark', () => {
    const chosen = benchmarkIdsOfDatasets(datasets, benchmarks, ['ds_v3', 'ds_loose']);
    expect(chosen).toEqual(['evb_hard10']);
    expect(datasetIdsOfBenchmarks(datasets, benchmarks, chosen)).toEqual(['ds_v2', 'ds_v3']);
  });

  it('ignores an unknown benchmark', () => {
    expect(datasetIdsOfBenchmarks(datasets, benchmarks, ['evb_gone'])).toEqual([]);
  });
});

describe('a benchmark’s fixed run rules', () => {
  const protocol = { k: 3, maxSteps: 30, timeoutMinutes: 20 };

  it('reads them from the benchmark, or from an older benchmark’s complete defaults', () => {
    expect(benchmarkProtocolOf({ metadata: { protocol } })).toEqual(protocol);
    expect(benchmarkProtocolOf({ metadata: { defaults: protocol } })).toEqual(protocol);
  });

  it('has none when they are missing or incomplete', () => {
    expect(benchmarkProtocolOf({ metadata: { defaults: { k: 3 } } })).toBeUndefined();
    expect(benchmarkProtocolOf({ metadata: {} })).toBeUndefined();
    expect(benchmarkProtocolOf(undefined)).toBeUndefined();
  });
});
