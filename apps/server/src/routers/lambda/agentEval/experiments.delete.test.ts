// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';

import { experimentRouter } from './experiments';
import type * as Procedures from './procedures';

const mocks = vi.hoisted(() => ({
  deleteRun: vi.fn(),
  experimentDelete: vi.fn(),
  runQuery: vi.fn(),
}));

// Bare procedure with mocked models so only the mutation body runs.
vi.mock('./procedures', async (importOriginal) => {
  const actual = await importOriginal<typeof Procedures>();
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  const procedure = publicProcedure.use((opts) =>
    opts.next({
      ctx: {
        experimentModel: { delete: mocks.experimentDelete },
        runModel: { query: mocks.runQuery },
        runService: { deleteRun: mocks.deleteRun },
      } as any,
    }),
  );
  return { ...actual, agentEvalProcedure: procedure, agentEvalProcedureWrite: procedure };
});

const experiments = createCallerFactory(experimentRouter)({} as any);

describe('deleteExperiment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.experimentDelete.mockResolvedValue({ rowCount: 1 });
    mocks.deleteRun.mockResolvedValue({ rowCount: 1 });
  });

  it('only detaches runs by default (Evaluation Lab semantics)', async () => {
    await expect(experiments.deleteExperiment({ id: 'exp_1' })).resolves.toEqual({ success: true });
    expect(mocks.runQuery).not.toHaveBeenCalled();
    expect(mocks.deleteRun).not.toHaveBeenCalled();
    expect(mocks.experimentDelete).toHaveBeenCalledWith('exp_1');
  });

  it('deletes every run of the experiment before the experiment when asked to', async () => {
    mocks.runQuery.mockResolvedValue([
      { id: 'run_a', status: 'completed' },
      { id: 'run_b', status: 'failed' },
    ]);
    await expect(experiments.deleteExperiment({ id: 'exp_1', withRuns: true })).resolves.toEqual({
      success: true,
    });
    expect(mocks.runQuery).toHaveBeenCalledWith({ experimentId: 'exp_1' });
    expect(mocks.deleteRun.mock.calls.map(([id]) => id).sort()).toEqual(['run_a', 'run_b']);
    expect(mocks.deleteRun.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.experimentDelete.mock.invocationCallOrder[0],
    );
  });

  it('refuses while a run is still in flight and deletes nothing', async () => {
    mocks.runQuery.mockResolvedValue([
      { id: 'run_a', status: 'completed' },
      { id: 'run_b', status: 'running' },
    ]);
    await expect(experiments.deleteExperiment({ id: 'exp_1', withRuns: true })).resolves.toEqual({
      error: 'Stop the experiment before deleting it',
      success: false,
    });
    expect(mocks.deleteRun).not.toHaveBeenCalled();
    expect(mocks.experimentDelete).not.toHaveBeenCalled();
  });

  it('reports an unknown experiment', async () => {
    mocks.runQuery.mockResolvedValue([]);
    mocks.experimentDelete.mockResolvedValue({ rowCount: 0 });
    await expect(experiments.deleteExperiment({ id: 'exp_x', withRuns: true })).resolves.toEqual({
      error: 'Experiment not found',
      success: false,
    });
  });
});
