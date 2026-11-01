import { type ExecSubAgentParams, ThreadStatus } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { buildLlmExecutorDeclaration, oneShotRelay } from '@/services/llmRelay';
import type { ChatStore } from '@/store/chat/store';

import { ClientSubAgentTransport } from './ClientSubAgentTransport';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execSubAgentTask: vi.fn(),
    getSubAgentTaskStatus: vi.fn(),
    interruptTask: vi.fn(),
    releaseSubAgentLlmRelay: vi.fn(),
  },
}));

vi.mock('@/business/client/trpc-headers', () => ({
  getBusinessTrpcHeaders: vi.fn(async () => ({ 'X-Workspace-Id': 'ws_a1b2c3d4e5f6' })),
}));

vi.mock('@/services/llmRelay', () => ({
  buildLlmExecutorDeclaration: vi.fn(),
  oneShotRelay: { run: vi.fn() },
}));

const params: ExecSubAgentParams = {
  agentId: 'agent-1',
  groupId: 'group-1',
  instruction: 'Investigate the issue',
  parentMessageId: 'tool-message-1',
  parentOperationId: 'root-operation',
  timeout: 30_000,
  title: 'Investigation',
  topicId: 'topic-1',
};

const createStore = () => {
  const operation = {
    abortController: new AbortController(),
    context: { agentId: 'agent-1', topicId: 'topic-1' },
    metadata: { startTime: Date.now() },
    status: 'running',
    type: 'execAgentRuntime',
  };
  const store = {
    internal_dispatchMessage: vi.fn(),
    operations: { 'root-operation': operation },
  } as unknown as ChatStore;

  return { operation, store };
};

const dispatchResult = {
  assistantMessageId: 'assistant-message-1',
  operationId: 'child-operation',
  success: true,
  threadId: 'child-thread',
};

describe('ClientSubAgentTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValue(dispatchResult);
    vi.mocked(aiAgentService.interruptTask).mockResolvedValue({ success: true });
    vi.mocked(aiAgentService.releaseSubAgentLlmRelay).mockResolvedValue({ success: true });
    // Outside the `agent_llm_relay` rollout: no executor, the request runs as-is.
    vi.mocked(buildLlmExecutorDeclaration).mockReturnValue(undefined);
    vi.mocked(oneShotRelay.run).mockImplementation(async (_provider, request) => request());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards dispatch context and returns the completed terminal result', async () => {
    const { store } = createStore();
    vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValueOnce({
      result: 'Investigation complete',
      status: 'completed',
      taskDetail: { status: ThreadStatus.Completed, threadId: 'child-thread' },
    });
    const transport = new ClientSubAgentTransport(() => store, 'root-operation');

    const result = await transport.execSubAgent(params);

    expect(aiAgentService.execSubAgentTask).toHaveBeenCalledWith(params);
    expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
      {
        id: 'tool-message-1',
        type: 'updateMessage',
        value: {
          taskDetail: { status: ThreadStatus.Completed, threadId: 'child-thread' },
        },
      },
      { operationId: 'root-operation' },
    );
    expect(result).toEqual({
      ...dispatchResult,
      result: 'Investigation complete',
      status: 'completed',
      success: true,
    });
  });

  it('returns a terminal failure when dispatch is rejected', async () => {
    const { store } = createStore();
    vi.mocked(aiAgentService.execSubAgentTask).mockResolvedValueOnce({
      assistantMessageId: '',
      error: 'Dispatch failed',
      operationId: '',
      success: false,
      threadId: '',
    });
    const transport = new ClientSubAgentTransport(() => store, 'root-operation');

    const result = await transport.execSubAgent(params);

    expect(result).toMatchObject({
      error: 'Dispatch failed',
      status: 'failed',
      success: false,
      threadId: '',
    });
    expect(aiAgentService.getSubAgentTaskStatus).not.toHaveBeenCalled();
  });

  it('interrupts an already-dispatched child when status polling fails', async () => {
    const { store } = createStore();
    vi.mocked(aiAgentService.getSubAgentTaskStatus).mockRejectedValueOnce(
      new Error('Status unavailable'),
    );
    const transport = new ClientSubAgentTransport(() => store, 'root-operation');

    const result = await transport.execSubAgent(params);

    expect(aiAgentService.interruptTask).toHaveBeenCalledWith({ threadId: 'child-thread' });
    expect(result).toMatchObject({
      error: 'Status unavailable',
      operationId: 'child-operation',
      status: 'failed',
      success: false,
      threadId: 'child-thread',
    });
  });

  it('interrupts the child when the parent is cancelled before polling', async () => {
    const { operation, store } = createStore();
    vi.mocked(aiAgentService.execSubAgentTask).mockImplementationOnce(async () => {
      operation.status = 'cancelled';
      return dispatchResult;
    });
    const transport = new ClientSubAgentTransport(() => store, 'root-operation');

    const result = await transport.execSubAgent(params);

    expect(aiAgentService.interruptTask).toHaveBeenCalledWith({ threadId: 'child-thread' });
    expect(aiAgentService.getSubAgentTaskStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: 'Operation cancelled',
      status: 'cancelled',
      success: false,
      threadId: 'child-thread',
    });
  });

  it('wakes a pending poll immediately when the parent aborts', async () => {
    vi.useFakeTimers();
    const { operation, store } = createStore();
    vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({ status: 'processing' });
    const transport = new ClientSubAgentTransport(() => store, 'root-operation');

    const execution = transport.execSubAgent(params);
    await vi.advanceTimersByTimeAsync(0);
    expect(aiAgentService.getSubAgentTaskStatus).toHaveBeenCalledOnce();

    operation.abortController.abort();
    const result = await execution;

    expect(aiAgentService.interruptTask).toHaveBeenCalledOnce();
    expect(result.status).toBe('cancelled');
  });

  it('interrupts and reports a timeout after the configured deadline', async () => {
    vi.useFakeTimers();
    const { store } = createStore();
    vi.mocked(aiAgentService.getSubAgentTaskStatus).mockResolvedValue({ status: 'processing' });
    const transport = new ClientSubAgentTransport(() => store, 'root-operation');

    const execution = transport.execSubAgent({ ...params, timeout: 10 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await execution;

    expect(aiAgentService.interruptTask).toHaveBeenCalledWith({ threadId: 'child-thread' });
    expect(result).toMatchObject({
      error: 'Task timeout after 10ms',
      status: 'timed_out',
      success: false,
    });
  });

  it('stands by on a relay channel while the child runs, so its device-only LLM calls reach this tab', async () => {
    const { store } = createStore();
    const llmExecutor = {
      capabilities: ['llm_relay@1'],
      clientId: 'tab-1',
      providers: ['ollama', 'openai'],
    };
    const channel = 'llmcall:user-1:ws_a1b2c3d4e5f6-3f2a9c1d8e7b4a60';
    let standingBy = false;
    vi.mocked(buildLlmExecutorDeclaration).mockImplementation(() =>
      // The provider runtime state loads after the transport is called.
      vi.mocked(oneShotRelay.run).mock.calls.length > 0 ? llmExecutor : undefined,
    );
    vi.mocked(oneShotRelay.run).mockImplementation(async (provider, request, options) => {
      // Bound to the workspace the dispatch runs in.
      expect(options).toMatchObject({ scope: 'ws_a1b2c3d4e5f6' });
      // The providers are read when the relay asks for them, after the
      // provider runtime state has loaded — not snapshotted at dispatch.
      expect(typeof provider === 'function' ? provider() : provider).toEqual(['ollama', 'openai']);
      standingBy = true;
      try {
        return await request({ channel, headers: {} });
      } finally {
        standingBy = false;
      }
    });
    vi.mocked(aiAgentService.getSubAgentTaskStatus).mockImplementation(async () => {
      // Still subscribed while the child is polled.
      expect(standingBy).toBe(true);
      return { result: 'done', status: 'completed' } as any;
    });

    const result = await new ClientSubAgentTransport(() => store, 'root-operation').execSubAgent(
      params,
    );

    expect(aiAgentService.execSubAgentTask).toHaveBeenCalledWith({
      ...params,
      llmExecutor,
      llmRelayChannel: channel,
    });
    expect(aiAgentService.releaseSubAgentLlmRelay).toHaveBeenCalledWith({ channel });
    expect(result).toMatchObject({ result: 'done', status: 'completed', success: true });
  });
});
