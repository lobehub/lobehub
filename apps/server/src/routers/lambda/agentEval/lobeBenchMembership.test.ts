import { describe, expect, it, vi } from 'vitest';

import {
  assertDatasetDeletable,
  assertDatasetMove,
  prepareBenchmarkDeletion,
} from './lobeBenchMembership';

const lobeBench = { kind: 'lobe-bench' };

const context = (rows: {
  benchmarks?: Record<string, { metadata?: Record<string, unknown> }>;
  datasets?: Record<string, { benchmarkId?: string | null; metadata?: Record<string, unknown> }>;
  /** Experiments linked to the benchmark, as they stand once its runs are gone. */
  experiments?: Record<string, { benchmarks: Array<{ id: string }>; runs: unknown[] }>;
  runs?: Array<{ id: string; status?: string }>;
}) => {
  const deleteRun = vi.fn(async () => undefined);
  const releaseDatasets = vi.fn(async () => 1);
  const deleteExperiment = vi.fn(async () => undefined);
  return {
    ctx: {
      benchmarkModel: {
        findById: async (id: string) => rows.benchmarks?.[id],
        releaseDatasets,
      },
      datasetModel: { findById: async (id: string) => rows.datasets?.[id] },
      experimentModel: {
        delete: deleteExperiment,
        findByBenchmarkIds: async () =>
          Object.keys(rows.experiments ?? {}).map((experimentId) => ({ experimentId })),
        findById: async (id: string) => rows.experiments?.[id],
      },
      runModel: { query: async () => rows.runs ?? [] },
      runService: { deleteRun },
    },
    deleteExperiment,
    deleteRun,
    releaseDatasets,
  };
};

describe('Lobe Bench datasets and the benchmark they are in', () => {
  it('lets a free dataset join a benchmark that has not run yet', async () => {
    const { ctx } = context({
      benchmarks: { fresh: { metadata: lobeBench } },
      datasets: { ds: { benchmarkId: null, metadata: lobeBench } },
    });
    await expect(assertDatasetMove(ctx, 'ds', 'fresh')).resolves.toBeUndefined();
  });

  it('keeps a dataset in its benchmark and a benchmark that has run closed', async () => {
    const inBenchmark = context({
      benchmarks: { other: { metadata: lobeBench } },
      datasets: { ds: { benchmarkId: 'mine', metadata: lobeBench } },
    });
    await expect(assertDatasetMove(inBenchmark.ctx, 'ds', 'other')).rejects.toThrow(
      'stays in the benchmark',
    );
    const ran = context({
      benchmarks: { ran: { metadata: lobeBench } },
      datasets: { ds: { benchmarkId: null, metadata: lobeBench } },
      runs: [{ id: 'run', status: 'completed' }],
    });
    await expect(assertDatasetMove(ran.ctx, 'ds', 'ran')).rejects.toThrow('has runs');
  });

  it('leaves Evaluation Lab datasets alone', async () => {
    const { ctx } = context({ datasets: { ds: { benchmarkId: 'a', metadata: {} } } });
    await expect(assertDatasetMove(ctx, 'ds', 'b')).resolves.toBeUndefined();
    await expect(assertDatasetDeletable(ctx, 'ds')).resolves.toBeUndefined();
  });

  it('deletes a dataset in a benchmark only with the benchmark', async () => {
    const { ctx } = context({
      datasets: {
        free: { benchmarkId: null, metadata: lobeBench },
        taken: { benchmarkId: 'bench', metadata: lobeBench },
      },
    });
    await expect(assertDatasetDeletable(ctx, 'taken')).rejects.toThrow('Delete the benchmark');
    await expect(assertDatasetDeletable(ctx, 'free')).resolves.toBeUndefined();
  });

  it('deletes a benchmark’s runs and frees its datasets before the benchmark goes', async () => {
    const { ctx, deleteRun, releaseDatasets } = context({
      benchmarks: { bench: { metadata: lobeBench } },
      runs: [
        { id: 'run-1', status: 'completed' },
        { id: 'run-2', status: 'failed' },
      ],
    });
    await prepareBenchmarkDeletion(ctx, 'bench');
    expect(deleteRun.mock.calls).toEqual([['run-1'], ['run-2']]);
    expect(releaseDatasets).toHaveBeenCalledWith('bench');
  });

  it('deletes an experiment left empty by the benchmark, keeping ones that span others or still run', async () => {
    const { ctx, deleteExperiment } = context({
      benchmarks: { bench: { metadata: lobeBench } },
      experiments: {
        emptied: { benchmarks: [{ id: 'bench' }], runs: [] },
        sharedWithAnother: { benchmarks: [{ id: 'bench' }, { id: 'other' }], runs: [] },
        stillHasRuns: { benchmarks: [{ id: 'bench' }], runs: [{ id: 'kept' }] },
      },
      runs: [{ id: 'run-1', status: 'completed' }],
    });
    await prepareBenchmarkDeletion(ctx, 'bench');
    expect(deleteExperiment.mock.calls).toEqual([['emptied']]);
  });

  it('refuses to delete a benchmark while one of its runs is going', async () => {
    const { ctx, deleteRun, releaseDatasets } = context({
      benchmarks: { bench: { metadata: lobeBench } },
      runs: [{ id: 'run-1', status: 'running' }],
    });
    await expect(prepareBenchmarkDeletion(ctx, 'bench')).rejects.toThrow('Stop the experiments');
    expect(deleteRun).not.toHaveBeenCalled();
    expect(releaseDatasets).not.toHaveBeenCalled();
  });
});
