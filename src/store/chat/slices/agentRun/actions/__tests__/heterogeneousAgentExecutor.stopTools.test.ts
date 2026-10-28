/**
 * A user stop must leave no tool card looking finished. Replays the Copilot
 * CLI 1.0.105 recording of a stop during an allowed `sleep 30`: Copilot never
 * sends a terminal update for that tool, and the adapter's synthesized
 * cancelled result arrives after the stop, when the executor drops events.
 */
import { createAdapter } from '@lobechat/heterogeneous-agents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import recording from '../../../../../../../packages/heterogeneous-agents/src/spawn/__fixtures__/copilotAcp/acp-cancel-during-tool.jsonl?raw';
import type { HeterogeneousAgentExecutorParams } from '../transports/hetero/heterogeneousAgentExecutor';
import { executeHeterogeneousAgent } from '../transports/hetero/heterogeneousAgentExecutor';

const mockBatchMutate = vi.fn();
const mockCreateMessage = vi.fn();
vi.mock('@/services/message', () => ({
  messageService: {
    batchMutate: (...args: any[]) => mockBatchMutate(...args),
    createMessage: (...args: any[]) => mockCreateMessage(...args),
    getMessages: vi.fn(async () => []),
    updateMessage: vi.fn(async () => undefined),
    updateMessageError: vi.fn(async () => ({ success: false })),
    updateToolMessage: vi.fn(async () => undefined),
  },
}));
vi.mock('@/services/thread', () => ({
  threadService: {
    createThread: vi.fn(async (params: any) => params.id),
    getThreads: vi.fn(async () => []),
    updateThread: vi.fn(),
  },
}));

let resolveSendPrompt: () => void;
vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    cancelSession: vi.fn(async () => undefined),
    getClaudeCodeIdentity: vi.fn(async () => null),
    getCodexQuota: vi.fn(async () => null),
    getSessionInfo: vi.fn(async () => ({ agentSessionId: 'copilot-session-1' })),
    sendPrompt: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSendPrompt = resolve;
        }),
    ),
    startSession: vi.fn(async () => ({ sessionId: 'ipc-sess-1' })),
    stopSession: vi.fn(async () => undefined),
  },
}));
vi.mock('@/services/agentQuota', () => ({
  agentQuotaService: {
    recordUsage: vi.fn(async () => undefined),
    selectAccountForAgent: vi.fn(async () => null),
  },
}));
vi.mock('../transports/gateway/gatewayEventHandler', () => ({
  createGatewayEventHandler: vi.fn(() => vi.fn()),
}));

/** The `session/update` payloads Copilot streamed before the user stopped. */
const recordedUpdates = (): Record<string, unknown>[] =>
  recording
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((frame) => frame.method === 'session/update')
    .map((frame) => frame.params.update);

/** A read tool that finished before the stop; it must keep its result. */
const finishedRead = [
  {
    kind: 'read',
    rawInput: { path: 'notes.txt' },
    sessionUpdate: 'tool_call',
    status: 'pending',
    title: 'Viewing notes.txt',
    toolCallId: 'call_read',
  },
  {
    rawOutput: { content: 'hello' },
    sessionUpdate: 'tool_call_update',
    status: 'completed',
    toolCallId: 'call_read',
  },
];

const params: HeterogeneousAgentExecutorParams = {
  assistantMessageId: 'ast-initial',
  context: { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
  heterogeneousProvider: { command: 'copilot', type: 'copilot' },
  message: 'Run the long command.',
  operationId: 'op-1',
};

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 10));
};

describe('heterogeneousAgentExecutor — tools left running by a user stop', () => {
  let listeners: Map<string, (...args: any[]) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    listeners = new Map();
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
    mockCreateMessage.mockImplementation(async (message: any) => ({ id: message.id }));
    mockBatchMutate.mockImplementation(async (operations: any[]) => {
      const results = operations.map((operation, index) => ({
        id: operation.type === 'createMessage' ? operation.message.id : operation.id,
        index,
        success: true,
        type: operation.type,
      }));
      for (const operation of operations) {
        if (operation.type === 'createMessage') await mockCreateMessage(operation.message);
      }
      return { results, success: true };
    });
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('marks the running tool aborted and leaves the finished one alone', async () => {
    const abortController = new AbortController();
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
        'op-1': {
          abortController,
          context: params.context,
          metadata: { startTime: 0 },
        },
      },
      optimisticUpdateMessagePlugin: vi.fn(async () => undefined),
      refreshMessages: vi.fn(async () => {}),
      refreshThreads: vi.fn(async () => {}),
      replaceMessages: vi.fn(),
      startOperation: vi.fn(() => ({
        abortController: new AbortController(),
        operationId: 'sub-op-1',
      })),
      topicDataMap: {},
      updateOperationMetadata: vi.fn(),
      updateTopicMetadata: vi.fn(async () => undefined),
    } as any;

    const adapter = createAdapter('copilot');
    const emit = (raw: Record<string, unknown>) => {
      for (const event of adapter.adapt(raw)) {
        listeners.get('heteroAgentEvent')?.(null, {
          event: { ...event, operationId: 'op-1' },
          sessionId: 'ipc-sess-1',
        });
      }
    };

    const run = executeHeterogeneousAgent(() => store, params);
    await flush();

    emit({ sessionId: 'copilot-session-1', type: 'copilot_session' });
    for (const update of [...finishedRead, ...recordedUpdates()]) emit(update);
    await flush();

    // The user stops while `sleep 30` runs; Copilot then ends the turn cancelled.
    abortController.abort();
    emit({ stopReason: 'cancelled', type: 'copilot_prompt_completed' });
    listeners.get('heteroAgentSessionComplete')?.(null, { sessionId: 'ipc-sess-1' });
    resolveSendPrompt();
    await run.catch(() => {});
    await flush();

    const toolRowId = (toolCallId: string) =>
      mockCreateMessage.mock.calls.find(
        ([message]) => message.role === 'tool' && message.tool_call_id === toolCallId,
      )?.[0].id;
    const sleepRow = toolRowId('call_mock_7');
    const readRow = toolRowId('call_read');
    expect(sleepRow).toBeDefined();
    expect(readRow).toBeDefined();

    const abortedRows = store.optimisticUpdateMessagePlugin.mock.calls
      .filter(([, value]: any[]) => value?.intervention?.status === 'aborted')
      .map(([id]: any[]) => id);
    expect(abortedRows).toEqual([sleepRow]);
  });
});
