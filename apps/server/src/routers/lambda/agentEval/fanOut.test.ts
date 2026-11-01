// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';

import { RUN_ENRICHMENT_CONCURRENCY } from './constants';
import { experimentRouter } from './experiments';
import type * as Procedures from './procedures';
import { runRouter } from './runs';

const mocks = vi.hoisted(() => ({
  datasetFindById: vi.fn(),
  experimentFindById: vi.fn(),
  getAgentDisplayInfo: vi.fn(),
  resumeTrajectory: vi.fn(),
  runQuery: vi.fn(),
}));

// Replace the auth/RBAC/DB builders with a bare procedure that injects mocked
// models, so these tests exercise only the procedure bodies.
vi.mock('./procedures', async (importOriginal) => {
  const actual = await importOriginal<typeof Procedures>();
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  const procedure = publicProcedure.use((opts) =>
    opts.next({
      ctx: {
        datasetModel: { findById: mocks.datasetFindById },
        experimentModel: { findById: mocks.experimentFindById },
        runModel: { query: mocks.runQuery },
        runService: {
          getAgentDisplayInfo: mocks.getAgentDisplayInfo,
          resumeTrajectory: mocks.resumeTrajectory,
        },
      } as any,
    }),
  );
  return { ...actual, agentEvalProcedure: procedure, agentEvalProcedureWrite: procedure };
});

const ctx = {} as any;
const experiments = createCallerFactory(experimentRouter)(ctx);
const runs = createCallerFactory(runRouter)(ctx);

/** Wraps an async fn so each call resolves after a tick and tracks peak concurrency. */
const trackInFlight = <A extends unknown[], R>(fn: (...args: A) => R) => {
  const state = { inFlight: 0, max: 0 };
  const wrapped = async (...args: A) => {
    state.inFlight += 1;
    state.max = Math.max(state.max, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    state.inFlight -= 1;
    return fn(...args);
  };
  return { state, wrapped };
};

const agent = (id: string) => ({ avatar: null, id, title: `Agent ${id}` });
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agentEval router fan-outs', () => {
  it('getExperiment enriches every run in order with a bounded agent lookup', async () => {
    const agentIds = ids('agent-', 12);
    mocks.experimentFindById.mockResolvedValue({
      datasets: [{ id: 'ds-1', name: 'Dataset 1' }],
      id: 'exp-1',
      runs: agentIds.map((targetAgentId, i) => ({
        datasetId: 'ds-1',
        id: `run-${i}`,
        targetAgentId,
      })),
    });
    const tracker = trackInFlight((id: string) => agent(id));
    mocks.getAgentDisplayInfo.mockImplementation(tracker.wrapped);

    const result = await experiments.getExperiment({ id: 'exp-1' });

    expect(result.data.runs.map((r: any) => r.targetAgent)).toEqual(agentIds.map(agent));
    expect(result.data.runs.every((r: any) => r.datasetName === 'Dataset 1')).toBe(true);
    expect(tracker.state.max).toBeLessThanOrEqual(RUN_ENRICHMENT_CONCURRENCY);
    expect(tracker.state.max).toBeGreaterThan(1);
  });

  it('listRuns enriches dataset names and agents with bounded lookups', async () => {
    const rows = ids('', 12).map((i) => ({
      datasetId: `ds-${i}`,
      id: `run-${i}`,
      targetAgentId: `agent-${i}`,
    }));
    mocks.runQuery.mockResolvedValue(rows);
    const datasets = trackInFlight((id: string) => ({ id, name: `Name ${id}` }));
    const agents = trackInFlight((id: string) => agent(id));
    mocks.datasetFindById.mockImplementation(datasets.wrapped);
    mocks.getAgentDisplayInfo.mockImplementation(agents.wrapped);

    const result = await runs.listRuns({});

    expect(result.data.map((r: any) => [r.datasetName, r.targetAgent])).toEqual(
      rows.map((r) => [`Name ${r.datasetId}`, agent(r.targetAgentId)]),
    );
    expect(datasets.state.max).toBeLessThanOrEqual(RUN_ENRICHMENT_CONCURRENCY);
    expect(agents.state.max).toBeLessThanOrEqual(RUN_ENRICHMENT_CONCURRENCY);
  });

  it('batchResumeRunCases settles each target independently with bounded concurrency', async () => {
    const targets = ids('case-', 12).map((testCaseId) => ({ testCaseId }));
    const tracker = trackInFlight(({ testCaseId }: { testCaseId: string }) => {
      if (testCaseId === 'case-3' || testCaseId === 'case-7') throw new Error('resume failed');
      return { ok: true };
    });
    mocks.resumeTrajectory.mockImplementation(tracker.wrapped);

    const result = await runs.batchResumeRunCases({ runId: 'run-1', targets });

    expect(result).toEqual({ failed: 2, succeeded: 10, total: 12 });
    expect(mocks.resumeTrajectory).toHaveBeenCalledTimes(12);
    expect(tracker.state.max).toBeLessThanOrEqual(5);
    expect(tracker.state.max).toBeGreaterThan(1);
  });
});
