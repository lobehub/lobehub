// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const triggerMock = vi.fn();

vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'http://localhost:3011',
    INTERNAL_APP_URL: 'http://localhost:3011',
  },
}));

vi.mock('@/libs/qstash', () => ({
  workflowClient: {
    trigger: triggerMock,
  },
}));

describe('AgentSignalWorkflow', () => {
  beforeEach(() => {
    triggerMock.mockReset();
    triggerMock.mockResolvedValue({ workflowRunId: 'wfr_agent_signal' });
  });

  it('normalizes the flow-control key while preserving the workflow payload scope key', async () => {
    const { AgentSignalWorkflow } = await import('./agentSignal');

    await AgentSignalWorkflow.triggerRun({
      agentId: 'agent-1',
      sourceEvent: {
        payload: {
          message: 'Remember this',
          topicId: 'topic-1',
        },
        scopeKey: 'topic:topic-1',
        sourceId: 'source-1',
        sourceType: 'agent.user.message',
        timestamp: 1710000000000,
      },
      userId: 'user-1',
    });

    expect(triggerMock).toHaveBeenCalledWith({
      body: {
        agentId: 'agent-1',
        sourceEvent: {
          payload: {
            message: 'Remember this',
            topicId: 'topic-1',
          },
          scopeKey: 'topic:topic-1',
          sourceId: 'source-1',
          sourceType: 'agent.user.message',
          timestamp: 1710000000000,
        },
        userId: 'user-1',
      },
      flowControl: {
        key: 'agent-signal.run.scope.topic_topic-1',
        parallelism: 1,
      },
      headers: {},
      url: 'http://localhost:3011/api/workflows/agent-signal/run',
    });
  });
});
