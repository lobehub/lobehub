import type { WorkflowContext } from '@upstash/workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunAgentTrajectoryPayload } from '@/server/workflows/agentEvalRun';

import { runAgentTrajectoryHandler } from './runAgentTrajectory';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  execute: vi.fn(),
  load: vi.fn(),
  multi: vi.fn(),
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/server/services/agentEvalRun', () => ({
  AgentEvalRunService: vi.fn().mockImplementation(function () {
    return {
      executeMultiThreadTrajectory: mocks.multi,
      executeTrajectory: mocks.execute,
      loadTrajectoryData: mocks.load,
      recordTrajectoryCompletion: mocks.complete,
    };
  }),
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: { triggerFinalizeRun: vi.fn() },
}));
vi.mock('@/server/workflows/agentEvalRun/utils', () => ({
  resolveAgentEvalRunWorkspace: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/workflows/step', () => ({
  runStep: (_: unknown, __: string, fn: () => unknown) => fn(),
}));
const context = {
  requestPayload: { runId: 'run', testCaseId: 'case', userId: 'user' },
} as WorkflowContext<RunAgentTrajectoryPayload>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockReset();
  mocks.multi.mockReset();
  mocks.complete.mockResolvedValue({ allDone: false });
});

describe('runAgentTrajectory generation boundary', () => {
  it.each([1, 2])('returns cancellation when k=%s loses its execution claim', async (k) => {
    mocks.load.mockResolvedValue({ run: { config: { k } }, testCase: {} });
    expect(await runAgentTrajectoryHandler(context)).toEqual({ cancelled: true });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('forwards a startup failure with its claimed execution and topic IDs', async () => {
    mocks.load.mockResolvedValue({ run: {}, testCase: {} });
    mocks.execute.mockResolvedValue({
      error: 'provider unavailable',
      executionId: 'generation',
      topicId: 'topic',
    });
    await runAgentTrajectoryHandler(context);
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'generation', topicId: 'topic', status: 'error' }),
    );
  });
});
