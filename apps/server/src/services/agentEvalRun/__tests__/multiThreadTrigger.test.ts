import { describe, expect, it, vi } from 'vitest';

import { AgentEvalRunWorkflow } from '@/server/workflows/agentEvalRun';

import { executeMultiThreadTrajectory } from '../thread';
import type { EvalRunDeps } from '../types';

vi.mock('@/server/workflows/agentEvalRun', () => ({
  AgentEvalRunWorkflow: { triggerRunThreadTrajectory: vi.fn() },
}));

vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));

const createDeps = () => {
  let next = 0;
  return {
    runTopicModel: {
      findByRunAndTestCase: vi.fn().mockResolvedValue({ evalResult: null, topicId: 'topic-1' }),
      updateByRunAndTopic: vi.fn().mockResolvedValue(undefined),
    },
    threadModel: { create: vi.fn().mockImplementation(async () => ({ id: `thread-${next++}` })) },
    topicModel: { findById: vi.fn().mockResolvedValue({ metadata: {} }) },
    userId: 'user-1',
  };
};

describe('executeMultiThreadTrajectory', () => {
  it('attempts every pass@k trigger even when an early dispatch fails', async () => {
    const k = 8;
    const deps = createDeps();
    const failure = new Error('qstash down');
    const trigger = vi.mocked(AgentEvalRunWorkflow.triggerRunThreadTrajectory);
    trigger.mockReset();
    trigger.mockImplementation(async ({ threadId }) => {
      if (threadId === 'thread-0') throw failure;
      return undefined as any;
    });

    await expect(
      executeMultiThreadTrajectory(deps as unknown as EvalRunDeps, {
        k,
        run: { datasetId: 'dataset-1' },
        runId: 'run-1',
        testCaseId: 'case-1',
      }),
    ).rejects.toBe(failure);

    expect(trigger).toHaveBeenCalledTimes(k);
    expect(new Set(trigger.mock.calls.map(([params]) => params.threadId)).size).toBe(k);
  });
});
