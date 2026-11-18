/** Antigravity stream → tool persistence, final reply and resumable session identity. */
import type { AgentEventAdapter } from '@lobechat/heterogeneous-agents';
import { createAdapter } from '@lobechat/heterogeneous-agents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HeterogeneousAgentExecutorParams } from '../transports/hetero/heterogeneousAgentExecutor';
import { executeHeterogeneousAgent } from '../transports/hetero/heterogeneousAgentExecutor';

const mockBatchMutate = vi.fn();
const mockCreateMessage = vi.fn();
const mockUpdateMessage = vi.fn();
const mockUpdateToolMessage = vi.fn();
vi.mock('@/services/message', () => ({
  messageService: {
    batchMutate: (...args: any[]) => mockBatchMutate(...args),
    createMessage: (...args: any[]) => mockCreateMessage(...args),
    getMessages: vi.fn(async () => []),
    updateMessage: (...args: any[]) => mockUpdateMessage(...args),
    updateMessageError: vi.fn(async () => ({ success: false })),
    updateToolMessage: (...args: any[]) => mockUpdateToolMessage(...args),
  },
}));

vi.mock('@/services/thread', () => ({
  threadService: {
    createThread: vi.fn(async (params: any) => params.id),
    getThreads: vi.fn(async () => []),
    updateThread: vi.fn(),
  },
}));

const mockStartSession = vi.fn();
const mockSendPrompt = vi.fn();
const mockGetSessionInfo = vi.fn();
vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    cancelSession: vi.fn(async () => undefined),
    getClaudeCodeIdentity: vi.fn(async () => null),
    getCodexQuota: vi.fn(async () => null),
    getSessionInfo: (...args: any[]) => mockGetSessionInfo(...args),
    sendPrompt: (...args: any[]) => mockSendPrompt(...args),
    startSession: (...args: any[]) => mockStartSession(...args),
    stopSession: vi.fn(async () => undefined),
  },
}));

// Unmocked, account routing and the usage ledger fire real trpc fetches.
vi.mock('@/services/agentQuota', () => ({
  agentQuotaService: {
    recordUsage: vi.fn(async () => undefined),
    selectAccountForAgent: vi.fn(async () => null),
  },
}));

vi.mock('../transports/gateway/gatewayEventHandler', () => ({
  createGatewayEventHandler: vi.fn(() => vi.fn()),
}));

const IPC_SESSION = 'ipc-sess-1';

const defaultParams: HeterogeneousAgentExecutorParams = {
  assistantMessageId: 'ast-initial',
  context: { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
  heterogeneousProvider: { command: 'agy', type: 'antigravity' },
  message: 'test prompt',
  operationId: 'op-1',
};

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 10));
};

const createMockStore = () => {
  const store = {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    dbMessagesMap: {},
    drainQueuedMessages: vi.fn(() => []),
    internal_dispatchMessage: vi.fn(),
    internal_toggleToolCallingStreaming: vi.fn(),
    markTopicUnread: vi.fn(),
    messagesMap: {},
    operations: {
      'op-1': { context: defaultParams.context, metadata: { startTime: 0 } },
    } as Record<string, any>,
    refreshMessages: vi.fn(async () => {}),
    refreshThreads: vi.fn(async () => {}),
    replaceMessages: vi.fn(),
    sendMessage: vi.fn(async () => {}),
    startOperation: vi.fn(() => ({ abortController: new AbortController(), operationId: 'sub' })),
    topicDataMap: {},
    updateOperationMetadata: vi.fn((operationId: string, metadata: Record<string, any>) => {
      const operation = store.operations[operationId];
      if (operation) operation.metadata = { ...operation.metadata, ...metadata };
    }),
    updateTopicMetadata: vi.fn().mockResolvedValue(undefined),
  };
  return store as any;
};

/** Mirror main's raw stdout line → adapter → `heteroAgentEvent` broadcast. */
const setupIpc = () => {
  const listeners = new Map<string, (...args: any[]) => void>();
  (globalThis as any).window = {
    electron: {
      ipcRenderer: {
        on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
          listeners.set(channel, handler);
          return () => listeners.delete(channel);
        }),
        removeListener: vi.fn(),
      },
    },
  };
  let adapter: AgentEventAdapter | undefined;
  return {
    emitComplete: () =>
      listeners.get('heteroAgentSessionComplete')?.(null, { sessionId: IPC_SESSION }),
    emitRawLine: (raw: unknown) => {
      adapter ??= createAdapter('antigravity');
      for (const event of adapter.adapt(raw)) {
        listeners.get('heteroAgentEvent')?.(null, {
          event: { ...event, operationId: defaultParams.operationId },
          sessionId: IPC_SESSION,
        });
      }
    },
    sessionId: () => adapter?.sessionId,
  };
};

describe('heterogeneousAgentExecutor — Antigravity', () => {
  let ipc: ReturnType<typeof setupIpc>;

  beforeEach(() => {
    vi.clearAllMocks();
    ipc = setupIpc();
    mockStartSession.mockResolvedValue({ sessionId: IPC_SESSION });
    mockGetSessionInfo.mockImplementation(async () => ({ agentSessionId: ipc.sessionId() }));
    // Honor caller-provided ids: coordinators pre-allocate them to chain parentIds.
    mockCreateMessage.mockImplementation(async (params: any) => ({
      id: params.id ?? `created-${params.role}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    mockUpdateMessage.mockResolvedValue(undefined);
    mockUpdateToolMessage.mockResolvedValue(undefined);
    mockBatchMutate.mockImplementation(async (operations: any[]) => {
      const results = [];
      for (const [index, operation] of operations.entries()) {
        let id = operation.id;
        if (operation.type === 'createMessage')
          id = (await mockCreateMessage(operation.message)).id;
        else if (operation.type === 'updateToolMessage')
          await mockUpdateToolMessage(operation.id, operation.value, operation.ctx);
        else await mockUpdateMessage(operation.id, operation.value, operation.ctx);
        results.push({ id, index, success: true, type: operation.type });
      }
      return { results, success: true };
    });
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  const runWithEvents = async (
    rawEvents: unknown[],
    opts?: { params?: Partial<HeterogeneousAgentExecutorParams> },
  ) => {
    const store = createMockStore();
    let resolveSendPrompt!: () => void;
    mockSendPrompt.mockReturnValue(new Promise<void>((r) => (resolveSendPrompt = r)));

    const executorPromise = executeHeterogeneousAgent(
      vi.fn(() => store),
      { ...defaultParams, ...opts?.params },
    );
    await flush();
    for (const raw of rawEvents) ipc.emitRawLine(raw);
    ipc.emitComplete();
    await flush();
    resolveSendPrompt();
    await executorPromise;
    await flush();
    return { store };
  };

  it('persists native Antigravity tools, final reply and resumable conversation identity', async () => {
    const { store } = await runWithEvents(
      [
        { event: 'init', conversation_id: 'agy-conversation', init: { cwd: '/project' } },
        {
          event: 'step_update',
          step_update: {
            conversation_id: 'agy-conversation',
            step_index: 1,
            state: 'DONE',
            step_type: 'tool',
            tool_info: { name: 'read_file', parameters: { path: 'hello.txt' }, output: 'hello' },
          },
        },
        {
          event: 'step_update',
          step_update: {
            conversation_id: 'agy-conversation',
            step_index: 2,
            state: 'DONE',
            step_type: 'agent_response',
            text_delta: 'The file says hello.',
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        },
        {
          event: 'result',
          result: {
            conversation_id: 'agy-conversation',
            status: 'SUCCESS',
            response: 'The file says hello.',
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        },
      ],
      { params: { heterogeneousProvider: { command: 'agy', type: 'antigravity' } } },
    );

    const tool = mockCreateMessage.mock.calls.find(([p]) => p.role === 'tool')?.[0];
    expect(tool).toMatchObject({
      parentId: 'ast-initial',
      plugin: { apiName: 'read_file', identifier: 'antigravity' },
      tool_call_id: 'agy_agy-conversation_1',
    });
    expect(mockUpdateToolMessage).toHaveBeenCalledWith(
      tool.id,
      { content: 'hello', pluginError: undefined },
      { agentId: 'agent-1', topicId: 'topic-1' },
    );
    const finalAssistant = mockCreateMessage.mock.calls.find(([p]) => p.role === 'assistant')?.[0];
    expect(finalAssistant).toMatchObject({ parentId: 'ast-initial' });
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      finalAssistant.id,
      expect.objectContaining({
        content: 'The file says hello.',
      }),
      expect.anything(),
    );
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      finalAssistant.id,
      expect.objectContaining({ usage: expect.objectContaining({ totalTokens: 15 }) }),
      expect.anything(),
    );
    expect(store.updateTopicMetadata).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ heteroSessionId: 'agy-conversation' }),
    );
  });
});
