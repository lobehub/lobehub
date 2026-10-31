// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCallerFactory } from '@/libs/trpc/lambda';
import { EvalCaseCompatibilityError } from '@/server/services/agentEvalRun/caseCompatibility';
import { EvalResumeConflictError } from '@/server/services/agentEvalRun/resumeTarget';

import { runRouter } from './runs';

const mocks = vi.hoisted(() => ({
  dataset: vi.fn(),
  rejudge: vi.fn(),
  rerun: vi.fn(),
  resume: vi.fn(),
  retryErrors: vi.fn(),
  retrySingle: vi.fn(),
  trigger: vi.fn(),
  update: vi.fn(),
}));

vi.mock('./procedures', async () => {
  const { publicProcedure } = await import('@/libs/trpc/lambda');
  const procedure = publicProcedure.use((opts) =>
    opts.next({
      ctx: {
        datasetModel: { findById: mocks.dataset },
        runModel: {
          findById: async () => ({
            config: { caseVersion: 'v1' },
            datasetId: 'dataset',
            id: 'run',
            status: 'completed',
          }),
          update: mocks.update,
        },
        runService: {
          rejudgeRun: mocks.rejudge,
          resumeTrajectory: mocks.resume,
          rerunUnverifiedCases: mocks.rerun,
          retryErrorCases: mocks.retryErrors,
          retrySingleCase: mocks.retrySingle,
        },
      } as any,
    }),
  );
  return { agentEvalProcedure: procedure, agentEvalProcedureWrite: procedure };
});

vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: {
    triggerExecuteTestCase: mocks.trigger,
    triggerRunBenchmark: mocks.trigger,
  },
}));

const runs = createCallerFactory(runRouter)({} as any);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.dataset.mockResolvedValue({ metadata: { release: 'v2' } });
  for (const call of [mocks.rejudge, mocks.rerun, mocks.retryErrors, mocks.retrySingle]) {
    call.mockRejectedValue(new EvalCaseCompatibilityError('The dataset case version changed'));
  }
});

describe('run compatibility conflicts', () => {
  it('rejects starting an old-version run before changing its status or dispatching', async () => {
    await expect(runs.startRun({ id: 'run' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it('maps all rejected rejudge and retry paths to conflicts without dispatching', async () => {
    await expect(runs.rejudgeRun({ id: 'run' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(runs.rerunRunUnverified({ id: 'run' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(runs.retryRunErrors({ id: 'run' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(runs.retryRunCase({ runId: 'run', testCaseId: 'case' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(mocks.trigger).not.toHaveBeenCalled();
  });
});

it.each([EvalResumeConflictError, EvalCaseCompatibilityError])(
  'maps rejected Resume to CONFLICT (%s)',
  async (ConflictError) => {
    mocks.resume.mockRejectedValue(new ConflictError('Resume target changed'));
    await expect(runs.resumeRunCase({ runId: 'run', testCaseId: 'case' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  },
);
