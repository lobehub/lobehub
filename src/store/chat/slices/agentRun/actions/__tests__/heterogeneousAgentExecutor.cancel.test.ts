/** Stopping a heterogeneous run while a tool is still executing. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeHeterogeneousAgent } from '../transports/hetero/heterogeneousAgentExecutor';
import {
  ccInit,
  ccToolResult,
  ccToolUse,
  createMockStore,
  defaultParams,
  flush,
  setupIpcCapture,
} from './heterogeneousAgentExecutor.testUtils';

const mockBatchMutate = vi.fn();
const mockCreateMessage = vi.fn();
const mockSendPrompt = vi.fn();
const mockStartSession = vi.fn();

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { info: vi.fn() },
}));

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

vi.mock('@/services/electron/heterogeneousAgent', () => ({
  heterogeneousAgentService: {
    cancelSession: vi.fn(async () => undefined),
    getClaudeCodeIdentity: vi.fn(async () => null),
    getCodexQuota: vi.fn(async () => null),
    getSessionInfo: vi.fn(async () => ({})),
    sendPrompt: (...args: any[]) => mockSendPrompt(...args),
    startSession: (...args: any[]) => mockStartSession(...args),
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

describe('heterogeneousAgentExecutor cancellation', () => {
  let ipc: ReturnType<typeof setupIpcCapture>;

  /** Feed CC events while the prompt is in flight, optionally stopping before completion. */
  const run = async (store: any, events: any[], beforeComplete?: () => void) => {
    let resolvePrompt!: () => void;
    mockSendPrompt.mockReturnValue(new Promise<void>((resolve) => (resolvePrompt = resolve)));
    const executor = executeHeterogeneousAgent(() => store, defaultParams);
    await flush();
    for (const event of events) ipc.emitRawLine('ipc-sess-1', event);
    await flush();
    beforeComplete?.();
    ipc.emitComplete('ipc-sess-1');
    await flush();
    resolvePrompt();
    await executor;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ipc = setupIpcCapture();
    mockStartSession.mockImplementation(async (params: any) => {
      ipc.setAgentType('ipc-sess-1', params.agentType ?? 'claude-code');
      return { sessionId: 'ipc-sess-1' };
    });
    mockCreateMessage.mockImplementation(async (params: any) => ({ id: params.id }));
    mockBatchMutate.mockImplementation(async (operations: any[]) => {
      for (const operation of operations) {
        if (operation.type === 'createMessage') await mockCreateMessage(operation.message);
      }
      return {
        results: operations.map((operation, index) => ({ index, success: true, ...operation })),
        success: true,
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * @example The user stops a run during `sleep 60`; the tool card must not show a success check.
   */
  it('marks tools still running at a stop as aborted and leaves finished tools alone', async () => {
    // ROOT CAUSE:
    //
    // A stop aborts the operation first, so every later CLI event — including
    // the adapter's own tool cleanup — is dropped. A tool that had not returned
    // kept an empty row with no intervention, which renders as a finished
    // (green check) call, and reloads showed no trace of the interruption.
    //
    // Before: the cancel path only stopped the CLI session.
    // After: unfinished main-agent tools are persisted as cancelled + aborted.
    const abortController = new AbortController();
    const store = createMockStore({
      onOperationCancel: vi.fn(),
      operations: {
        'op-1': {
          abortController,
          context: { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
          metadata: { startTime: 0 },
        },
      },
      optimisticUpdateMessageContent: vi.fn(async () => {}),
      optimisticUpdateMessagePlugin: vi.fn(async () => {}),
    });
    await run(
      store,
      [
        ccInit(),
        ccToolUse('msg-1', 'tool-done', 'Read', { file_path: '/a' }),
        ccToolResult('tool-done', 'file text'),
        ccToolUse('msg-2', 'tool-running', 'Bash', { command: 'sleep' }),
      ],
      () => abortController.abort(),
    );

    const toolMessageId = (toolCallId: string) =>
      mockCreateMessage.mock.calls.find(
        ([message]) => message.role === 'tool' && message.tool_call_id === toolCallId,
      )?.[0].id;
    const runningId = toolMessageId('tool-running');
    expect(runningId).toBeDefined();
    expect(store.optimisticUpdateMessagePlugin.mock.calls).toEqual([
      [runningId, { intervention: { status: 'aborted' } }, { operationId: 'op-1' }],
    ]);
    expect(store.optimisticUpdateMessageContent.mock.calls).toEqual([
      [runningId, 'Tool execution was cancelled by user.', undefined, { operationId: 'op-1' }],
    ]);
  });

  it('leaves tool rows untouched when the run was not stopped', async () => {
    const store = createMockStore({
      onOperationCancel: vi.fn(),
      optimisticUpdateMessageContent: vi.fn(async () => {}),
      optimisticUpdateMessagePlugin: vi.fn(async () => {}),
    });
    await run(store, [ccInit(), ccToolUse('msg-1', 'tool-open', 'Bash', { command: 'sleep' })]);

    expect(store.optimisticUpdateMessagePlugin).not.toHaveBeenCalled();
    expect(store.optimisticUpdateMessageContent).not.toHaveBeenCalled();
  });
});
