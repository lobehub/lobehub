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
  executeAgentSignalSourceEvent: vi.fn(),
  inMemorySourceEventStore: {
    kind: 'memory',
  },
  inMemoryRuntimeGuardBackend: {
    kind: 'memory-guard',
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

vi.mock('@/server/services/agentSignal/orchestrator', () => ({
  executeAgentSignalSourceEvent: mocks.executeAgentSignalSourceEvent,
}));

vi.mock('@/server/services/agentSignal/store/adapters/memory/sourceEventStore', () => ({
  inMemorySourceEventStore: mocks.inMemorySourceEventStore,
}));

vi.mock('@/server/services/agentSignal/runtime/backend/memoryGuard', () => ({
  inMemoryRuntimeGuardBackend: mocks.inMemoryRuntimeGuardBackend,
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
  vi.restoreAllMocks();
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
      expect.objectContaining({
        createRuntimeGuardBackend: expect.any(Function),
        executeSourceEvent: expect.any(Function),
      }),
    );

    const dependencies = mocks.runAgentSignalWorkflow.mock.calls[0][1];
    expect(dependencies.createRuntimeGuardBackend()).toBe(mocks.inMemoryRuntimeGuardBackend);

    const executeSourceEvent = dependencies.executeSourceEvent;
    const input = { sourceId: 'source-1' };
    const context = { userId: 'user-1' };
    const options = { runtimeGuardBackend: { kind: 'memory' } };

    await executeSourceEvent(input, context, options);

    expect(mocks.executeAgentSignalSourceEvent).toHaveBeenCalledWith(input, context, {
      ...options,
      store: mocks.inMemorySourceEventStore,
    });
  });

  it('logs local workflow failures with correlation identifiers', async () => {
    const error = new Error('local workflow failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.runAgentSignalWorkflow.mockRejectedValueOnce(error);

    await AgentSignalWorkflow.triggerRun(createPayload());
    await vi.runAllTimersAsync();

    expect(consoleError).toHaveBeenCalledWith('[AgentSignal] Local workflow execution failed:', {
      agentId: 'agent-1',
      error,
      sourceId: 'source-1',
      userId: 'user-1',
      workflowRunId: 'local-source-1',
    });
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
