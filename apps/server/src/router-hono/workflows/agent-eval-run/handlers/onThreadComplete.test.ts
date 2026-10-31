import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { onThreadComplete } from './onThreadComplete';

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
    return { recordThreadCompletion: mocks.complete };
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
        threadId: 'thread',
        topicId: 'topic',
        userId: 'user',
        ...extra,
      }),
    },
  } as unknown as Context;
  await onThreadComplete(context);
  return json;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findRun.mockResolvedValue({ status: 'running' });
  mocks.complete.mockResolvedValue({ allRunDone: false, allThreadsDone: false });
});

describe('onThreadComplete generation boundary', () => {
  it('forwards the execution identity with its thread before finalizing accepted results', async () => {
    mocks.complete.mockResolvedValue({ allRunDone: true, allThreadsDone: true });
    await invoke({ executionId: 'generation-2' });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'generation-2',
        runId: 'run',
        testCaseId: 'case',
        threadId: 'thread',
        topicId: 'topic',
      }),
    );
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith({ runId: 'run', userId: 'user' });
  });

  it('does not finalize when the service rejects a stale generation', async () => {
    const json = await invoke({ executionId: 'generation-1' });
    expect(mocks.complete.mock.calls[0][0].executionId).toBe('generation-1');
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ allRunDone: false, allThreadsDone: false, success: true });
  });

  it('leaves a missing legacy identity undefined for the service to validate', async () => {
    await invoke();
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete.mock.calls[0][0].executionId).toBeUndefined();
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('does not deliver or finalize callbacks for an aborted run', async () => {
    mocks.findRun.mockResolvedValue({ status: 'aborted' });
    const json = await invoke({ executionId: 'generation-1' });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ cancelled: true });
  });
});
