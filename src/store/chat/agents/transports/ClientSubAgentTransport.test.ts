import { type ExecSubAgentParams, ThreadStatus } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import type { ChatStore } from '@/store/chat/store';

import { ClientSubAgentTransport } from './ClientSubAgentTransport';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: {
    execSubAgentTask: vi.fn(),
    getSubAgentTaskStatus: vi.fn(),
    interruptTask: vi.fn(),
  },
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
});
