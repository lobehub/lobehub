// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentSignalWorkflowRunPayload } from '@/server/workflows/agentSignal';
import { AgentSignalWorkflow } from '@/server/workflows/agentSignal';

const mocks = vi.hoisted(() => ({
  appEnv: {
    APP_URL: 'http://localhost:3010',
    enableQueueAgentRuntime: false,
    INTERNAL_APP_URL: undefined as string | undefined,
  },
  injectActiveTraceHeaders: vi.fn(),
  runAgentSignalWorkflow: vi.fn(),
  trigger: vi.fn(),
}));

vi.mock('@/envs/app', () => ({
  appEnv: mocks.appEnv,
}));

vi.mock('@/libs/observability/traceparent', () => ({
  injectActiveTraceHeaders: mocks.injectActiveTraceHeaders,
}));

vi.mock('@/libs/qstash', () => ({
  workflowClient: {
    trigger: mocks.trigger,
  },
}));

vi.mock('@/server/workflows/agentSignal/run', () => ({
  runAgentSignalWorkflow: mocks.runAgentSignalWorkflow,
}));

const createPayload = (): AgentSignalWorkflowRunPayload => ({
  agentId: 'agent-1',
  sourceEvent: {
    payload: {
      agentId: 'agent-1',
      message: 'hello',
      messageId: 'message-1',
      topicId: 'topic-1',
    },
    scopeKey: 'topic:topic-1',
    sourceId: 'source-1',
    sourceType: 'agent.user.message',
    timestamp: 1,
  },
  userId: 'user-1',
});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.appEnv.enableQueueAgentRuntime = false;
  mocks.runAgentSignalWorkflow.mockResolvedValue({ success: true });
  mocks.trigger.mockResolvedValue({ workflowRunId: 'workflow-1' });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('AgentSignalWorkflow', () => {
  it('runs locally without contacting QStash when queue runtime is disabled', async () => {
    const payload = createPayload();

    await expect(AgentSignalWorkflow.triggerRun(payload)).resolves.toEqual({
      workflowRunId: 'local-source-1',
    });
    expect(mocks.runAgentSignalWorkflow).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(mocks.runAgentSignalWorkflow).toHaveBeenCalledOnce();
    expect(mocks.runAgentSignalWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ requestPayload: payload }),
    );
  });

  it('keeps using Upstash Workflow when queue runtime is enabled', async () => {
    mocks.appEnv.enableQueueAgentRuntime = true;

    await expect(AgentSignalWorkflow.triggerRun(createPayload())).resolves.toEqual({
      workflowRunId: 'workflow-1',
    });

    expect(mocks.trigger).toHaveBeenCalledOnce();
    expect(mocks.runAgentSignalWorkflow).not.toHaveBeenCalled();
  });
});
