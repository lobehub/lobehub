import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onTrajectoryComplete } from './onTrajectoryComplete';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  finalize: vi.fn(),
  findRun: vi.fn(),
}));

vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/agentEval', () => ({
  AgentEvalRunModel: vi.fn().mockImplementation(function () {
    return { findById: mocks.findRun };
  }),
}));
vi.mock('@/server/services/agentEvalRun', () => ({
  AgentEvalRunService: vi.fn().mockImplementation(function () {
    return { recordTrajectoryCompletion: mocks.complete };
  }),
}));
vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: { triggerFinalizeRun: mocks.finalize },
}));
vi.mock('@/server/workflows/agentEvalRun/utils', () => ({
  resolveAgentEvalRunWorkspace: vi.fn().mockResolvedValue('workspace'),
}));

const invoke = async (extra: Record<string, unknown> = {}) => {
  const json = vi.fn((body: unknown, status = 200) => ({ body, status }));
  const context = {
    json,
    req: {
      json: async () => ({
        operationId: 'operation',
        reason: 'stop',
        runId: 'run',
        status: 'completed',
        testCaseId: 'case',
        userId: 'user',
        ...extra,
      }),
    },
  } as unknown as Context;
  await onTrajectoryComplete(context);
  return json;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findRun.mockResolvedValue({ status: 'running' });
  mocks.complete.mockResolvedValue({ allDone: false, completedCount: 0 });
});

describe('onTrajectoryComplete generation boundary', () => {
  it('forwards the execution and topic identities before finalizing an accepted completion', async () => {
    mocks.complete.mockResolvedValue({ allDone: true, completedCount: 1 });
    await invoke({ executionId: 'generation-2', topicId: 'topic-2' });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'generation-2',
        runId: 'run',
        testCaseId: 'case',
        topicId: 'topic-2',
      }),
    );
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith({ runId: 'run', userId: 'user' });
  });

  it('does not finalize when the service rejects a stale generation', async () => {
    const json = await invoke({ executionId: 'generation-1', topicId: 'old-topic' });
    expect(mocks.complete.mock.calls[0][0]).toMatchObject({
      executionId: 'generation-1',
      topicId: 'old-topic',
    });
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it('leaves missing legacy identities undefined for the service to reject against a new generation', async () => {
    const json = await invoke();
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete.mock.calls[0][0].executionId).toBeUndefined();
    expect(mocks.complete.mock.calls[0][0].topicId).toBeUndefined();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it('does not deliver or finalize callbacks for an aborted run', async () => {
    mocks.findRun.mockResolvedValue({ status: 'aborted' });
    const json = await invoke({ executionId: 'generation-1', topicId: 'topic' });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ cancelled: true });
  });
});
