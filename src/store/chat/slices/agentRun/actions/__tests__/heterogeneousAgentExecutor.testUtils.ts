/** Shared harness for the heterogeneous agent executor scenario tests. */

import type { AgentEventAdapter } from '@lobechat/heterogeneous-agents';
import { createAdapter } from '@lobechat/heterogeneous-agents';
import { vi } from 'vitest';

import type { HeterogeneousAgentExecutorParams } from '../transports/hetero/heterogeneousAgentExecutor';

export function setupIpcCapture() {
  // Mock window.electron.ipcRenderer
  const listeners = new Map<string, (...args: any[]) => void>();
  (globalThis as any).window = {
    electron: {
      ipcRenderer: {
        on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
          listeners.set(channel, handler);
          return () => {
            if (listeners.get(channel) === handler) listeners.delete(channel);
          };
        }),
        // A separately bridged callback does not preserve the listener proxy identity.
        removeListener: vi.fn(),
      },
    },
  };

  /** Mirror main's raw-output → adapter → event pipeline. */
  const adapters = new Map<string, AgentEventAdapter>();
  /**
   * IPC-session → agent type. Defaults to `claude-code` so tests that don't
   * explicitly register codex still work; the multi-session resume test (and
   * any codex-only suite) registers explicitly via `setAgentType`.
   */
  const sessionAgentType = new Map<string, string>();

  const getAdapter = (sessionId: string) => {
    if (!adapters.has(sessionId)) {
      adapters.set(sessionId, createAdapter(sessionAgentType.get(sessionId) ?? 'claude-code'));
    }
    return adapters.get(sessionId)!;
  };

  return {
    getListeners: () => listeners,
    /** Register the agent type for an IPC session before emitting raw events. */
    setAgentType: (sessionId: string, type: string) => {
      sessionAgentType.set(sessionId, type);
    },
    /**
     * Look up the underlying adapter for an IPC session — used by the
     * `getSessionInfo` mock to mirror what main's `AgentStreamPipeline.sessionId`
     * returns to the renderer's post-prompt session-id sync.
     */
    getAdapterSessionId: (sessionId: string) => adapters.get(sessionId)?.sessionId,
    /**
     * Simulate the desktop main's per-stdout-line forwarding: feed `raw`
     * through the session's adapter, then broadcast each resulting
     * `AgentStreamEvent` over the `heteroAgentEvent` channel.
     */
    emitRawLine: (sessionId: string, raw: any) => {
      const handler = listeners.get('heteroAgentEvent');
      const adapter = getAdapter(sessionId);
      for (const event of adapter.adapt(raw)) {
        handler?.(null, {
          event: {
            data: event.data,
            operationId: defaultParams.operationId,
            stepIndex: event.stepIndex,
            timestamp: event.timestamp,
            type: event.type,
          },
          sessionId,
        });
      }
    },
    /** Emit an already-adapted AgentStreamEvent, matching main-process bridge events. */
    emitStreamEvent: (sessionId: string, event: Record<string, unknown>) => {
      const handler = listeners.get('heteroAgentEvent');
      handler?.(null, {
        event: {
          operationId: defaultParams.operationId,
          stepIndex: 0,
          timestamp: Date.now(),
          ...event,
        },
        sessionId,
      });
    },
    /** Simulate session completion */
    emitComplete: (sessionId: string) => {
      const handler = listeners.get('heteroAgentSessionComplete');
      handler?.(null, { sessionId });
    },
    /** Simulate session error */
    emitError: (sessionId: string, error: Record<string, unknown> | string) => {
      const handler = listeners.get('heteroAgentSessionError');
      handler?.(null, { error, sessionId });
    },
  };
}

export function createMockStore(overrides: Record<string, any> = {}) {
  // Hand out a fresh AbortController + monotonically increasing sub-op id
  // for each subagent run, mirroring `startOperation`'s contract just
  // enough that the executor can build dispatchers + completion calls.
  let subOpCounter = 0;
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
        context: { agentId: 'agent-1', scope: 'main', topicId: 'topic-1' },
        metadata: { startTime: 0 },
      },
    } as Record<string, any>,
    refreshMessages: vi.fn(async () => {}),
    refreshThreads: vi.fn(async () => {}),
    replaceMessages: vi.fn(),
    sendMessage: vi.fn(async () => {}),
    startOperation: vi.fn(() => {
      subOpCounter += 1;
      return {
        abortController: new AbortController(),
        operationId: `sub-op-${subOpCounter}`,
      };
    }),
    topicDataMap: {},
    updateTopicMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;

  if (!store.updateOperationMetadata) {
    store.updateOperationMetadata = vi.fn((operationId: string, metadata: Record<string, any>) => {
      const operation = store.operations[operationId];
      if (!operation) return;
      operation.metadata = {
        ...operation.metadata,
        ...metadata,
      };
    });
  }

  return store;
}

export const defaultContext = {
  agentId: 'agent-1',
  scope: 'main' as const,
  topicId: 'topic-1',
};

export const defaultParams: HeterogeneousAgentExecutorParams = {
  assistantMessageId: 'ast-initial',
  context: defaultContext,
  heterogeneousProvider: { command: 'claude', type: 'claude-code' as const },
  message: 'test prompt',
  operationId: 'op-1',
};

/** Flush async queues */
export const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
};

export const flushFakeTimers = async () => {
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(10);
  }
  await Promise.resolve();
};

// ─── CC stream-json event factories ───

export const ccInit = (sessionId = 'cc-sess-1') => ({
  model: 'claude-sonnet-4-6',
  session_id: sessionId,
  subtype: 'init',
  type: 'system',
});

export const ccAssistant = (
  msgId: string,
  content: any[],
  extra?: { model?: string; usage?: any },
) => ({
  message: {
    content,
    id: msgId,
    model: extra?.model || 'claude-sonnet-4-6',
    role: 'assistant',
    usage: extra?.usage,
  },
  type: 'assistant',
});

export const ccToolUse = (msgId: string, toolId: string, name: string, input: any = {}) =>
  ccAssistant(msgId, [{ id: toolId, input, name, type: 'tool_use' }]);

/**
 * CC subagent assistant event — carries `parent_tool_use_id` pointing back at
 * the outer `Task` tool_use. The adapter routes these through its subagent
 * handler which stamps `parentToolCallId` onto each tool payload.
 */
export const ccSubagentToolUse = (
  msgId: string,
  parentToolUseId: string,
  toolId: string,
  name: string,
  input: any = {},
) => ({
  message: {
    content: [{ id: toolId, input, name, type: 'tool_use' }],
    id: msgId,
    role: 'assistant',
  },
  parent_tool_use_id: parentToolUseId,
  type: 'assistant',
});

/** Subagent assistant event with text content (closing summary-style turn). */
export const ccSubagentText = (msgId: string, parentToolUseId: string, text: string) => ({
  message: {
    content: [{ text, type: 'text' }],
    id: msgId,
    role: 'assistant',
  },
  parent_tool_use_id: parentToolUseId,
  type: 'assistant',
});

/** The main-agent tool_result for a spawn tool_use (end of a subagent run). */
export const ccSubagentSpawnResult = (spawnToolUseId: string, finalText: string) => ({
  message: {
    content: [{ content: finalText, tool_use_id: spawnToolUseId, type: 'tool_result' }],
    role: 'user',
  },
  type: 'user',
});

/**
 * Subagent INNER tool_result: a user event tagged with `parent_tool_use_id`,
 * which the adapter routes through its subagent path so the emitted
 * `tool_result` + `tool_end` events both carry the `subagent` peer field.
 */
export const ccSubagentToolResult = (
  toolUseId: string,
  parentToolUseId: string,
  content: string,
  isError = false,
) => ({
  message: {
    content: [{ content, is_error: isError, tool_use_id: toolUseId, type: 'tool_result' }],
    role: 'user',
  },
  parent_tool_use_id: parentToolUseId,
  type: 'user',
});

export const ccText = (msgId: string, text: string) => ccAssistant(msgId, [{ text, type: 'text' }]);

export const ccThinking = (msgId: string, thinking: string) =>
  ccAssistant(msgId, [{ thinking, type: 'thinking' }]);

export const ccToolResult = (toolUseId: string, content: string, isError = false) => ({
  message: {
    content: [{ content, is_error: isError, tool_use_id: toolUseId, type: 'tool_result' }],
    role: 'user',
  },
  type: 'user',
});

export const ccResult = (isError = false, result = 'done') => ({
  is_error: isError,
  result,
  type: 'result',
});

/**
 * `stream_event: message_start` — primes adapter's in-flight message.id so a
 * following `message_delta` (which has no message.id of its own) can attach
 * its authoritative usage to the correct turn.
 */
export const ccMessageStart = (msgId: string, model = 'claude-sonnet-4-6') => ({
  event: { message: { id: msgId, model }, type: 'message_start' },
  type: 'stream_event',
});

/**
 * `stream_event: message_delta` — the authoritative per-turn usage under
 * `--include-partial-messages` (CC's `assistant` events only echo a stale
 * message_start snapshot, so turn_metadata is driven off this event).
 */
export const ccMessageDelta = (usage: {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}) => ({
  event: { type: 'message_delta', usage },
  type: 'stream_event',
});

// ─── Codex JSONL event factories ───

export const codexThreadStarted = (threadId = 'codex-thread-1') => ({
  thread_id: threadId,
  type: 'thread.started',
});

export const codexSessionConfigured = (model = 'gpt-5.5') => ({
  model,
  type: 'session_configured',
});

export const codexTurnStarted = () => ({
  type: 'turn.started',
});

export const codexAgentMessage = (id: string, text: string) => ({
  item: {
    id,
    text,
    type: 'agent_message',
  },
  type: 'item.completed',
});

export const codexCommandStarted = (id: string, command: string) => ({
  item: {
    aggregated_output: '',
    command,
    exit_code: null,
    id,
    status: 'in_progress',
    type: 'command_execution',
  },
  type: 'item.started',
});

export const codexCommandCompleted = (id: string, command: string, aggregatedOutput: string) => ({
  item: {
    aggregated_output: aggregatedOutput,
    command,
    exit_code: 0,
    id,
    status: 'completed',
    type: 'command_execution',
  },
  type: 'item.completed',
});

export const codexTodo = (
  lifecycle: 'item.completed' | 'item.started' | 'item.updated',
  completed: number,
) => ({
  item: {
    id: 'todo-1',
    items: [
      { completed: completed >= 1, text: 'Inspect' },
      { completed: completed >= 2, text: 'Implement' },
      { completed: completed >= 3, text: 'Verify' },
    ],
    status: lifecycle === 'item.completed' ? 'completed' : 'in_progress',
    type: 'todo_list',
  },
  type: lifecycle,
});

export const codexTurnCompleted = (usage?: {
  cached_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}) => ({
  ...(usage ? { usage } : {}),
  type: 'turn.completed',
});
