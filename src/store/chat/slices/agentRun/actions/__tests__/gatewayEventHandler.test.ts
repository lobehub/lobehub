import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { emitClientAgentSignalSourceEvent } from '@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge';
import { notifyDesktopHumanApprovalRequired } from '@/store/chat/utils/desktopNotification';

import { buildRunLifecycle } from '../lifecycle/buildRunLifecycle';
import { createGatewayEventHandler } from '../transports/gateway/gatewayEventHandler';

vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn().mockResolvedValue([]),
    updateMessageError: vi.fn().mockResolvedValue({ success: true }),
  },
}));
vi.mock('@/store/chat/utils/desktopNotification', () => ({
  notifyDesktopHumanApprovalRequired: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/agentSignalBridge', () => ({
  emitClientAgentSignalSourceEvent: vi.fn().mockResolvedValue(undefined),
}));

const getExecutorMock = vi.fn();
vi.mock('@/store/tool/slices/builtin/executors', () => ({
  getExecutor: (...args: unknown[]) => getExecutorMock(...args),
}));

// ─── Test Helpers ───

function createMockStore() {
  let reasoningCounter = 0;
  return {
    associateMessageWithOperation: vi.fn(),
    completeOperation: vi.fn(),
    // completeRun (via buildRunLifecycle) drains the input queue on a successful
    // terminal and fails the op on an errored terminal.
    dbMessagesMap: {} as Record<string, any>,
    drainQueuedMessages: vi.fn(() => [] as any[]),
    failOperation: vi.fn(),
    internal_dispatchMessage: vi.fn(),
    internal_executeClientTool: vi.fn().mockResolvedValue(undefined),
    internal_toggleToolCallingStreaming: vi.fn(),
    internal_updateTopicLoading: vi.fn(),
    markTopicUnread: vi.fn(),
    messagesMap: {} as Record<string, any>,
    operations: {
      'op-1': {
        context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' },
        metadata: { startTime: 0 },
      },
    } as Record<string, any>,
    replaceMessages: vi.fn(),
    startOperation: vi.fn(() => {
      reasoningCounter += 1;
      return {
        abortController: new AbortController(),
        operationId: `op-reasoning-${reasoningCounter}`,
      };
    }),
    updateOperationMetadata: vi.fn(),
  };
}

function createHandler(
  store: ReturnType<typeof createMockStore>,
  overrides?: { assistantMessageId?: string; gatewayOperationId?: string },
) {
  const get = vi.fn(() => store) as any;
  const assistantMessageId = overrides?.assistantMessageId ?? 'msg-initial';
  const context = { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any;
  return createGatewayEventHandler(get, {
    assistantMessageId,
    context,
    gatewayOperationId: overrides?.gatewayOperationId,
    operationId: 'op-1',
    // The gateway transport injects the shared run lifecycle (built once per run
    // in gateway.ts). Build the real one here so the terminal completeRun /
    // afterRunComplete path under test runs against the mock store.
    runLifecycle: buildRunLifecycle(get, {
      context,
      parentMessageId: assistantMessageId,
      parentMessageType: 'assistant',
      runId: 'op-1',
      runScope: 'top_level',
      runtimeType: 'gateway',
    }),
  });
}

function makeEvent(type: AgentStreamEvent['type'], data?: any): AgentStreamEvent {
  return { data, id: '1', operationId: 'op-1', stepIndex: 0, timestamp: Date.now(), type };
}

/** Flush the async processing queue by draining microtasks + setTimeout queue */
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 15));
  }
};

// ─── Tests ───

describe('createGatewayEventHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stream_start', () => {
    it('should associate new message with operation and skip the DB refetch', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      await flush();

      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-step2', 'op-1');
      // Native gateway streams carry the new assistant id directly + a SoT
      // uiMessages snapshot on the preceding step_start, so stream_start must
      // NOT trigger a DB refetch (the refetch is what clobbered the streamed
      // assistantGroup with a stale placeholder).
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();
      expect(emitClientAgentSignalSourceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            anchorMessageId: 'msg-step2',
            assistantMessageId: 'msg-step2',
            operationId: 'op-1',
            stepIndex: 0,
          }),
          sourceType: 'client.gateway.stream_start',
        }),
      );
    });

    it('should keep current ID if event data has no assistantMessage', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', {}));
      await flush();

      // No new message to associate, but fetch still happens
      expect(store.associateMessageWithOperation).not.toHaveBeenCalled();
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should resolve the new assistant from DB on hetero newStep when the event has no assistantMessage id', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      vi.mocked(messageService.getMessages).mockResolvedValueOnce([
        { id: 'msg-initial', role: 'assistant' } as any,
        { id: 'tool-1', role: 'tool' } as any,
        { id: 'msg-step2', role: 'assistant' } as any,
      ]);

      handler(makeEvent('stream_start', { newStep: true }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'world' }));
      await flush();

      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-step2', 'op-1');
      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'msg-step2',
          value: { content: 'world' },
        }),
        { operationId: 'op-1' },
      );
    });

    it('should reset accumulators on each stream_start', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Accumulate some content
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello' }));
      await flush();
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ value: { content: 'hello' } }),
        { operationId: 'op-1' },
      );

      // New stream_start resets
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'world' }));
      await flush();

      // Content should be 'world', not 'helloworld'
      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: 'msg-step2',
          value: { content: 'world' },
        }),
        { operationId: 'op-1' },
      );
    });
  });

  describe('stream_chunk', () => {
    it('should accumulate text content and pass operationId context', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Hello' }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: ' world' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { content: 'Hello world' },
        },
        { operationId: 'op-1' },
      );
    });

    it('should accumulate reasoning content', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'Think' }));
      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'ing...' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { reasoning: { content: 'Thinking...' } },
        },
        { operationId: 'op-1' },
      );
    });

    it('should dispatch tools and toggle tool calling streaming', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      const toolsCalling = [{ id: 'tc-1' }, { id: 'tc-2' }];
      handler(makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { tools: toolsCalling },
        },
        { operationId: 'op-1' },
      );

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-initial', [
        true,
        true,
      ]);
    });

    it('should ignore chunk with no data', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', undefined));
      await flush();

      expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
    });

    it('should DROP subagent-tagged tool chunks so they do not leak into the main bubble', async () => {
      // Regression: on a live gateway / remote-CC stream, a subagent (Agent/Task)
      // inner tool chunk is tagged with `data.subagent`. It belongs to an
      // isolation Thread, not the main assistant. If dispatched here it appends
      // to the MAIN assistant's tools[] until the terminal DB refetch corrects it
      // ("流式时漏出来、结束后正常"). It must be dropped before any dispatch.
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          subagent: { parentToolCallId: 'toolu_agent', subagentMessageId: 'sub-1' },
          toolsCalling: [{ id: 'inner-1' }],
        }),
      );
      await flush();

      // Not dispatched onto the main assistant, and no tool-calling spinner.
      expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
      expect(store.internal_toggleToolCallingStreaming).not.toHaveBeenCalled();
    });

    it('should still dispatch a NON-subagent tool chunk (drop is scoped to subagent)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling: [{ id: 'm-1' }] }),
      );
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        { id: 'msg-initial', type: 'updateMessage', value: { tools: [{ id: 'm-1' }] } },
        { operationId: 'op-1' },
      );
    });
  });

  describe('reasoning operation lifecycle', () => {
    it('starts a reasoning op on the first reasoning chunk and associates it with the current assistant', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'pondering' }));
      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: '...' }));
      await flush();

      // Only one startOperation call — second chunk reuses the existing op
      expect(store.startOperation).toHaveBeenCalledTimes(1);
      expect(store.startOperation).toHaveBeenCalledWith({
        context: expect.objectContaining({
          agentId: 'agent-1',
          messageId: 'msg-initial',
          topicId: 'topic-1',
        }),
        parentOperationId: 'op-1',
        type: 'reasoning',
      });
      expect(store.associateMessageWithOperation).toHaveBeenCalledWith(
        'msg-initial',
        'op-reasoning-1',
      );
      // The reasoning op is NOT completed while only reasoning chunks have arrived
      expect(store.completeOperation).not.toHaveBeenCalled();
    });

    it('completes the reasoning op when text starts streaming', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'answer' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('completes the reasoning op when tools_calling starts', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(
        makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [{ id: 'tc-1' }],
        }),
      );
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('starts a new reasoning op when reasoning resumes after text in the same stream', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'first pass' }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial' }));
      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'second pass' }));
      await flush();

      expect(store.startOperation).toHaveBeenCalledTimes(2);
      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
      expect(store.completeOperation).not.toHaveBeenCalledWith('op-reasoning-2');
    });

    it('completes any open reasoning op on stream_end', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('stream_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('completes any open reasoning op on stream_start (carry-over between steps)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('completes any open reasoning op on agent_runtime_end', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('completes any open reasoning op on error', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking' }));
      handler(makeEvent('error', { message: 'boom' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
    });

    it('does not start a reasoning op for text-only streams', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello' }));
      handler(makeEvent('stream_end'));
      await flush();

      expect(store.startOperation).not.toHaveBeenCalled();
    });
  });

  describe('stream_end', () => {
    it('keeps visible loading for a plain no-tool stream boundary', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello back' }));
      handler(makeEvent('stream_end'));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
      expect(store.updateOperationMetadata).not.toHaveBeenCalledWith('op-1', {
        visibleLoadingDone: true,
      });
      expect(store.completeOperation).not.toHaveBeenCalledWith('op-1');
      expect(store.internal_updateTopicLoading).not.toHaveBeenCalledWith('topic-1', false);
    });

    it('keeps visible loading after stream_end when tool calls need another step', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [{ id: 'tc-1' }],
        }),
      );
      handler(makeEvent('stream_end'));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
      expect(store.updateOperationMetadata).not.toHaveBeenCalledWith('op-1', {
        visibleLoadingDone: true,
      });
      expect(store.completeOperation).not.toHaveBeenCalledWith('op-1');
      expect(store.internal_updateTopicLoading).not.toHaveBeenCalledWith('topic-1', false);
    });

    it('applies finalContent before ending a reasoning-only stream', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'reasoning', reasoning: 'thinking text' }));
      handler(makeEvent('stream_end', { finalContent: 'final answer' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: { content: 'final answer' },
        },
        { operationId: 'op-1' },
      );
      expect(store.completeOperation).toHaveBeenCalledWith('op-reasoning-1');
      expect(store.updateOperationMetadata).not.toHaveBeenCalledWith('op-1', {
        visibleLoadingDone: true,
      });
    });

    it('should clear tool streaming', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_end'));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
    });
  });

  describe('visible_output_end', () => {
    it('marks visible loading done without completing the operation or clearing topic loading', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hello back' }));
      handler(makeEvent('visible_output_end'));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
      expect(store.updateOperationMetadata).toHaveBeenCalledWith('op-1', {
        visibleLoadingDone: true,
      });
      expect(store.completeOperation).not.toHaveBeenCalledWith('op-1');
      // Sidebar "running" spinner is driven off `topic.status === 'running'`
      // (persisted, reset at the terminal) for gateway/hetero runs — not the
      // client-only `topicLoadingIds` overlay — so visible_output_end no longer
      // clears it early.
      expect(store.internal_updateTopicLoading).not.toHaveBeenCalled();
    });
  });

  describe('tool_start', () => {
    it('should be a no-op (loading already active from stream_start)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_start', { parentMessageId: 'msg-initial', toolCalling: {} }));
      await flush();

      expect(store.internal_dispatchMessage).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();
    });
  });

  describe('step_start', () => {
    it('should notify desktop when human approval is required', () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('step_start', {
          pendingToolsCalling: [{ id: 'tool-1' }],
          phase: 'human_approval',
          requiresApproval: true,
        }),
      );

      expect(notifyDesktopHumanApprovalRequired).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          agentId: 'agent-1',
          topicId: 'topic-1',
        }),
      );
    });
  });

  describe('tool_execute', () => {
    const toolExecuteData = {
      apiName: 'readFile',
      arguments: '{"path":"/tmp/a.txt"}',
      executionTimeoutMs: 60_000,
      identifier: 'local-system',
      toolCallId: 'call_1',
    };

    it('forwards the payload to internal_executeClientTool with operationId', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_execute', toolExecuteData));
      await flush();

      expect(store.internal_executeClientTool).toHaveBeenCalledWith(toolExecuteData, {
        operationId: 'op-1',
      });
    });

    it('uses gatewayOperationId (WS key) when distinct from local operationId', async () => {
      // Locally the handler tracks `op-1` (used for message dispatch), but
      // the Agent Gateway WS is keyed on the server-side id `gw-op-server`.
      // The action must receive the latter so it can look up the live
      // AgentStreamClient in `gatewayConnections` and reply with tool_result.
      const store = createMockStore();
      const handler = createHandler(store, { gatewayOperationId: 'gw-op-server' });

      handler(makeEvent('tool_execute', toolExecuteData));
      await flush();

      expect(store.internal_executeClientTool).toHaveBeenCalledWith(toolExecuteData, {
        operationId: 'gw-op-server',
      });
    });

    it('is fire-and-forget — does not block the event pipeline', async () => {
      const store = createMockStore();
      // Simulate a slow tool execution that never resolves
      store.internal_executeClientTool.mockImplementation(() => new Promise(() => {}));
      const handler = createHandler(store);

      handler(makeEvent('tool_execute', toolExecuteData));
      // If the handler awaited the action, this subsequent stream_chunk would
      // be queued behind the pending promise forever. We assert it still runs.
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'hi' }));
      await flush();

      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ value: { content: 'hi' } }),
        expect.any(Object),
      );
    });

    it('ignores tool_execute events without data', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_execute'));
      await flush();

      expect(store.internal_executeClientTool).not.toHaveBeenCalled();
    });
  });

  describe('tool_end', () => {
    it('should refresh messages to pull tool results', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('tool_end', { isSuccess: true }));
      await flush();

      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should dispatch onAfterCall when payload is wrapped as { parentMessageId, toolCalling } (real gateway shape)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onAfterCall = vi.fn().mockResolvedValue(undefined);
      getExecutorMock.mockReturnValueOnce({ onAfterCall });

      handler(
        makeEvent('tool_end', {
          isSuccess: true,
          payload: {
            parentMessageId: 'msg-parent',
            toolCalling: {
              apiName: 'deleteTask',
              arguments: JSON.stringify({ identifier: 'T-3' }),
              id: 'tc-1',
              identifier: 'lobe-task',
            },
          },
          result: { content: 'Task deleted', success: true },
        }),
      );
      await flush();

      expect(getExecutorMock).toHaveBeenCalledWith('lobe-task');
      expect(onAfterCall).toHaveBeenCalledWith({
        apiName: 'deleteTask',
        identifier: 'lobe-task',
        params: { identifier: 'T-3' },
        result: { content: 'Task deleted', success: true },
        toolCallId: 'tc-1',
      });
    });

    it('should also dispatch onAfterCall when payload is the flat ChatToolPayload', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onAfterCall = vi.fn().mockResolvedValue(undefined);
      getExecutorMock.mockReturnValueOnce({ onAfterCall });

      handler(
        makeEvent('tool_end', {
          isSuccess: true,
          payload: {
            apiName: 'createTask',
            arguments: JSON.stringify({ name: 'New', instruction: 'do thing' }),
            id: 'tc-2',
            identifier: 'lobe-task',
          },
          result: { success: true },
        }),
      );
      await flush();

      expect(onAfterCall).toHaveBeenCalledWith(
        expect.objectContaining({
          apiName: 'createTask',
          identifier: 'lobe-task',
          toolCallId: 'tc-2',
        }),
      );
    });

    it('should skip onAfterCall when payload identifier/apiName are missing', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onAfterCall = vi.fn();
      getExecutorMock.mockReturnValue({ onAfterCall });

      handler(makeEvent('tool_end', { isSuccess: true, payload: { parentMessageId: 'x' } }));
      await flush();

      expect(onAfterCall).not.toHaveBeenCalled();
    });
  });

  describe('tool_start', () => {
    it('should dispatch onBeforeCall with the unwrapped ChatToolPayload', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const onBeforeCall = vi.fn().mockResolvedValue(undefined);
      getExecutorMock.mockReturnValueOnce({ onBeforeCall });

      handler(
        makeEvent('tool_start', {
          parentMessageId: 'msg-parent',
          toolCalling: {
            apiName: 'editTask',
            arguments: JSON.stringify({ identifier: 'T-5', name: 'renamed' }),
            id: 'tc-3',
            identifier: 'lobe-task',
          },
        }),
      );
      await flush();

      expect(onBeforeCall).toHaveBeenCalledWith({
        apiName: 'editTask',
        identifier: 'lobe-task',
        params: { identifier: 'T-5', name: 'renamed' },
        toolCallId: 'tc-3',
      });
    });
  });

  describe('step_complete', () => {
    it('should refresh on execution_complete phase', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('step_complete', { phase: 'execution_complete', reason: 'done' }));
      await flush();

      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should not refresh on other phases', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('step_complete', { phase: 'human_approval' }));
      await flush();

      expect(store.replaceMessages).not.toHaveBeenCalled();
    });
  });

  describe('agent_runtime_end', () => {
    it('should complete operation and refresh messages', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should emit runtime end signal with the current assistant message id', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(emitClientAgentSignalSourceEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            anchorMessageId: 'msg-step2',
            assistantMessageId: 'msg-step2',
            operationId: 'op-1',
          }),
          sourceType: 'client.gateway.runtime_end',
        }),
      );
    });

    // MID-stream cancel. The server-side coordinator skips the
    // uiMessages snapshot when state.status='interrupted' to avoid pushing
    // a LOADING_FLAT placeholder. The client must mirror that intent: when
    // `reason='interrupted'` arrives without uiMessages AND we already have
    // server-confirmed streamed state, do NOT fall back to a DB refetch —
    // the executor's partial-finalize catch is still racing to write the
    // real content, and a fetch here would return placeholder and clobber
    // in-memory streamed content.
    it('should NOT refetch from DB when reason=interrupted AND stream had progressed', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Simulate a stream that had progressed: server-assigned assistant id
      // arrived via stream_start, then a text chunk landed.
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-server' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial answer' }));
      await flush();
      vi.mocked(messageService.getMessages).mockClear();
      store.replaceMessages.mockClear();

      handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();
    });

    // Reviewer feedback on PR #15173: if cancel arrives BEFORE any
    // stream activity (no server-assigned assistant id, no chunks), the
    // optimistic `tmp_*` placeholder messages are the only client-side
    // state and they need the DB refetch to be reconciled with the
    // server-side rows. Skipping the fallback would leave the tmp_*
    // ids stuck in the store indefinitely.
    it('should refetch from DB when reason=interrupted but stream never progressed', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // No stream_start / stream_chunk before the cancel — only optimistic
      // local state exists, no server-confirmed assistant id, no chunks.
      handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      // Refetch IS called so the tmp_* placeholders get reconciled.
      expect(messageService.getMessages).toHaveBeenCalled();
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should still use uiMessages SoT when reason=interrupted but server included a snapshot', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const uiMessages = [{ id: 'msg-initial', role: 'assistant', content: 'partial' }];

      handler(
        makeEvent('agent_runtime_end', {
          reason: 'interrupted',
          uiMessages,
        }),
      );
      await flush();

      // uiMessages present takes precedence over the interrupted skip — the
      // SoT push is authoritative when server chose to send it.
      expect(store.replaceMessages).toHaveBeenCalledWith(uiMessages, {
        action: 'gateway/agent_runtime_end',
        context: expect.any(Object),
      });
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('should dispatch inline error, complete operation, and refresh messages', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('error', { message: 'Something went wrong' }));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-initial',
        undefined,
      );
      // error→fail: an errored gateway run FAILS the op (not complete).
      expect(store.failOperation).toHaveBeenCalledWith('op-1', expect.anything());
      expect(store.completeOperation).not.toHaveBeenCalled();
      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        {
          body: { message: 'Something went wrong' },
          message: 'Something went wrong',
          type: 'AgentRuntimeError',
        },
        {
          agentId: 'agent-1',
          groupId: undefined,
          threadId: undefined,
          topicId: 'topic-1',
        },
      );

      // Should dispatch inline error immediately
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        {
          id: 'msg-initial',
          type: 'updateMessage',
          value: {
            error: {
              body: { message: 'Something went wrong' },
              message: 'Something went wrong',
              type: 'AgentRuntimeError',
            },
          },
        },
        { operationId: 'op-1' },
      );

      // Should also refresh messages
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should dispatch inline error with switched message ID', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-step2' } }));
      handler(makeEvent('error', { error: 'Timeout' }));
      await flush();

      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-step2',
        undefined,
      );
      expect(store.failOperation).toHaveBeenCalledWith('op-1', expect.anything());
      expect(store.completeOperation).not.toHaveBeenCalled();
      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-step2',
        {
          body: { message: 'Timeout' },
          message: 'Timeout',
          type: 'AgentRuntimeError',
        },
        {
          agentId: 'agent-1',
          groupId: undefined,
          threadId: undefined,
          topicId: 'topic-1',
        },
      );

      // Should dispatch inline error with the switched message ID
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-step2',
          value: expect.objectContaining({
            error: expect.objectContaining({
              message: 'Timeout',
              body: { message: 'Timeout' },
            }),
          }),
        }),
        { operationId: 'op-1' },
      );
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    it('should preserve structured heterogeneous agent error payloads', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('error', {
          body: {
            agentType: 'codex',
            code: 'cli_not_found',
            docsUrl: 'https://github.com/openai/codex',
            installCommands: ['npm install -g @openai/codex'],
            message: 'Codex CLI was not found',
          },
          message: 'Codex CLI was not found',
          type: 'AgentRuntimeError',
        }),
      );
      await flush();

      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        {
          body: {
            agentType: 'codex',
            code: 'cli_not_found',
            docsUrl: 'https://github.com/openai/codex',
            installCommands: ['npm install -g @openai/codex'],
            message: 'Codex CLI was not found',
          },
          message: 'Codex CLI was not found',
          type: 'AgentRuntimeError',
        },
        expect.any(Object),
      );
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          value: {
            error: {
              body: {
                agentType: 'codex',
                code: 'cli_not_found',
                docsUrl: 'https://github.com/openai/codex',
                installCommands: ['npm install -g @openai/codex'],
                message: 'Codex CLI was not found',
              },
              message: 'Codex CLI was not found',
              type: 'AgentRuntimeError',
            },
          },
        }),
        { operationId: 'op-1' },
      );
    });

    it('should prefer updateMessageError returned messages over an extra refetch', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const persistedMessages = [{ id: 'msg-initial', role: 'assistant' }];

      vi.mocked(messageService.updateMessageError).mockResolvedValueOnce({
        messages: persistedMessages as any,
        success: true,
      });

      handler(makeEvent('error', { message: 'Something went wrong' }));
      await flush();

      expect(store.replaceMessages).toHaveBeenCalledWith(persistedMessages, {
        context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' },
      });
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });

    it('should ignore late events after an error so the inline error is not overwritten', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const persistedMessages = [{ id: 'msg-initial', role: 'assistant' }];

      vi.mocked(messageService.updateMessageError).mockResolvedValueOnce({
        messages: persistedMessages as any,
        success: true,
      });

      handler(makeEvent('error', { message: 'Something went wrong' }));
      handler(makeEvent('tool_end', { isSuccess: true }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'late chunk' }));
      await flush();

      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.internal_dispatchMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          value: { content: 'late chunk' },
        }),
        expect.any(Object),
      );
      expect(store.replaceMessages).toHaveBeenCalledTimes(1);
    });
  });

  describe('sequential processing', () => {
    it('should dispatch stream_chunk to the new assistant id after stream_start switches it', async () => {
      // Native gateway streams no longer await a DB fetch on stream_start
      // — but stream_chunk must still queue behind stream_start
      // so the chunk targets the NEW assistant id (from stream_start.data),
      // not the previous one.
      const store = createMockStore();
      const callOrder: string[] = [];

      store.internal_dispatchMessage.mockImplementation(() => {
        callOrder.push('dispatch');
      });
      store.associateMessageWithOperation.mockImplementation(() => {
        callOrder.push('associate');
      });

      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-new' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Hello' }));
      await flush();

      // associate (from stream_start) precedes dispatch (from stream_chunk)
      const associateIdx = callOrder.indexOf('associate');
      const dispatchIdx = callOrder.indexOf('dispatch');
      expect(associateIdx).toBeGreaterThan(-1);
      expect(dispatchIdx).toBeGreaterThan(associateIdx);

      // Chunk targets the new id, proving the queue ordering held
      expect(store.internal_dispatchMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'msg-new', value: { content: 'Hello' } }),
        { operationId: 'op-1' },
      );
      // And no DB refetch was issued for the native stream
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });

    it('should still fetch from DB on stream_start when assistantMessage id is absent (hetero CLI)', async () => {
      // Hetero CLI adapters (Claude Code / Codex) never set
      // `assistantMessage.id` on stream_start, so the DB read is still
      // mandatory — it pulls the executor-created placeholder into
      // `dbMessagesMap` so subsequent chunks have a target.
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', {}));
      await flush();

      expect(messageService.getMessages).toHaveBeenCalled();
      expect(store.replaceMessages).toHaveBeenCalled();
    });
  });

  describe('multi-step integration', () => {
    it('should handle full LLM → tools → LLM cycle', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Step 1: LLM call
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-1' } }));
      await flush();
      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-1', 'op-1');

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Let me search.' }));
      await flush();
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-1', value: { content: 'Let me search.' } }),
        { operationId: 'op-1' },
      );

      const tools = [{ id: 'tc-1' }];
      handler(makeEvent('stream_chunk', { chunkType: 'tools_calling', toolsCalling: tools }));
      await flush();
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-1', [true]);

      handler(makeEvent('stream_end'));
      await flush();
      // Loading stays active between steps — only tool streaming is cleared
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith('msg-1', undefined);

      // Tool execution — tool_end still refreshes from DB to pick up the
      // server-created tool message row.
      handler(makeEvent('tool_start', { parentMessageId: 'msg-1', toolCalling: tools[0] }));
      handler(makeEvent('tool_end', { isSuccess: true }));
      await flush();
      expect(store.replaceMessages).toHaveBeenCalled();

      // Step 2: Next LLM call with new assistant message — native stream_start
      // carries the id directly, so it must NOT trigger a DB refetch
      // Only the association switch happens.
      vi.clearAllMocks();
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-2' } }));
      await flush();
      expect(store.associateMessageWithOperation).toHaveBeenCalledWith('msg-2', 'op-1');
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();

      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'Here are the results.' }));
      await flush();
      expect(store.internal_dispatchMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-2', value: { content: 'Here are the results.' } }),
        { operationId: 'op-1' },
      );

      handler(makeEvent('stream_end'));
      handler(makeEvent('agent_runtime_end'));
      await flush();
      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
    });
  });

  // ─── Characterization net (LOCKS CURRENT BEHAVIOR for an upcoming
  // lifecycle refactor). These tests must PASS against the code as-is.
  // They describe what the gateway terminal path does NOW, not ideal
  // behavior. If something reads like a bug it is locked as-is with a note.
  describe('gateway terminal characterization (lifecycle refactor regression net)', () => {
    // CONTRACT: the `error` event FAILS the operation
    // (`failOperation`) via the shared run lifecycle — an errored run is a failed
    // run, not a completed one. Like `agent_runtime_end`'s cancel/park endings it
    // does NOT mark the topic unread (no unread badge for a failed generation).
    it('error event FAILS the operation and does NOT call markTopicUnread', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('error', { message: 'kaboom' }));
      await flush();

      // failOperation IS called on error; completeOperation is NOT.
      expect(store.failOperation).toHaveBeenCalledWith('op-1', expect.anything());
      expect(store.completeOperation).not.toHaveBeenCalled();
      // markTopicUnread is NOT — even though operations['op-1'] has a
      // context.agentId (which WOULD trigger it on a clean agent_runtime_end).
      expect(store.markTopicUnread).not.toHaveBeenCalled();
    });

    it('error event preserves runtime payload errorType and budget context', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const budget = { required: 12 };

      handler(
        makeEvent('error', {
          budget,
          error: { message: 'Budget exceeded' },
          errorType: 'FreePlanLimit',
          provider: 'lobehub',
        }),
      );
      await flush();

      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        expect.objectContaining({
          body: expect.objectContaining({
            budget,
            message: 'Budget exceeded',
            provider: 'lobehub',
          }),
          message: 'Budget exceeded',
          type: 'FreePlanLimit',
        }),
        expect.anything(),
      );
    });

    it('error event preserves _responseBody while merging payload error metadata', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('error', {
          _responseBody: {
            error: { message: 'Payment required' },
            provider: 'lobehub',
          },
          error: { status: 402 },
          errorType: 'ProviderBizError',
        }),
      );
      await flush();

      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        expect.objectContaining({
          body: expect.objectContaining({
            error: { message: 'Payment required', status: 402 },
            message: 'Payment required',
            provider: 'lobehub',
          }),
          message: 'Payment required',
          type: 'ProviderBizError',
        }),
        expect.anything(),
      );
    });

    it('error event preserves normalized body fields for trace-id error UI', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(
        makeEvent('error', {
          body: {
            message: 'Upstream failed',
            traceId: 'trace-123',
          },
          error: 'Upstream failed',
          errorType: 'ProviderBizError',
          phase: 'llm_execution',
        }),
      );
      await flush();

      expect(messageService.updateMessageError).toHaveBeenCalledWith(
        'msg-initial',
        expect.objectContaining({
          body: expect.objectContaining({
            message: 'Upstream failed',
            traceId: 'trace-123',
          }),
          message: 'Upstream failed',
          type: 'ProviderBizError',
        }),
        expect.anything(),
      );
    });

    // Contrast probe: agent_runtime_end on the SAME operation (which has a
    // context.agentId) DOES mark unread completed — proving the negative
    // assertion above is the error path's own behavior, not a missing agentId.
    it('agent_runtime_end (same op, has context.agentId) DOES call markTopicUnread', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('agent_runtime_end'));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.markTopicUnread).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', topicId: 'topic-1' }),
      );
    });

    it.each(['interrupted', 'waiting_for_async_tool'])(
      'agent_runtime_end with reason "%s" completes the op but does NOT mark unread (cancel/park)',
      async (reason) => {
        const store = createMockStore();
        const handler = createHandler(store);

        handler(makeEvent('agent_runtime_end', { reason }));
        await flush();

        expect(store.completeOperation).toHaveBeenCalledWith('op-1');
        expect(store.markTopicUnread).not.toHaveBeenCalled();
      },
    );

    // the agent_runtime_end handler completes the op once via
    // the shared run lifecycle, and gateway.ts onSessionComplete no longer
    // double-completes (it only completes as the terminal-missing fallback). The
    // reducer is still idempotent (a stray second completeOperation on an
    // already-'completed' op is a no-throw, no-flip no-op) — locked here as a
    // safety net in case any path issues a redundant completion.
    it('completeOperation is idempotent: double-calling the same op leaves status=completed (no throw, no flip)', async () => {
      // Local harness whose completeOperation MIRRORS the real reducer
      // (operation/actions.ts completeOperation): set status to 'completed'
      // unless the op was 'cancelled'.
      const operations: Record<string, any> = {
        'op-1': {
          context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' },
          metadata: { startTime: 0 },
          status: 'running',
        },
      };
      const completeOperation = vi.fn((operationId: string) => {
        const op = operations[operationId];
        if (!op) return;
        if (op.status !== 'cancelled') op.status = 'completed';
        op.metadata.endTime = Date.now();
      });
      const store = {
        ...createMockStore(),
        completeOperation,
        operations,
      } as ReturnType<typeof createMockStore>;
      const get = vi.fn(() => store) as any;
      const handler = createGatewayEventHandler(get, {
        assistantMessageId: 'msg-initial',
        context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
        operationId: 'op-1',
        runLifecycle: buildRunLifecycle(get, {
          context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
          parentMessageId: 'msg-initial',
          parentMessageType: 'assistant',
          runId: 'op-1',
          runScope: 'top_level',
          runtimeType: 'gateway',
        }),
      });

      // First terminal completion (agent_runtime_end handler).
      handler(makeEvent('agent_runtime_end'));
      await flush();
      expect(operations['op-1'].status).toBe('completed');

      // Second completion (as onSessionComplete in gateway.ts would issue).
      store.completeOperation('op-1');
      expect(operations['op-1'].status).toBe('completed');
      expect(completeOperation).toHaveBeenCalledTimes(2);
    });

    // CURRENT BEHAVIOR: if the op was cancelled mid-flight, completeOperation
    // does NOT flip it to 'completed' (operation/actions.ts:288-291 preserves
    // the user's interruption state). Lock this so the refactor can't quietly
    // resurrect a cancelled op into 'completed' on a stray terminal event.
    it('completeOperation preserves a cancelled op (does not flip cancelled → completed)', async () => {
      const operations: Record<string, any> = {
        'op-1': {
          context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' },
          metadata: { startTime: 0 },
          status: 'cancelled',
        },
      };
      const completeOperation = vi.fn((operationId: string) => {
        const op = operations[operationId];
        if (!op) return;
        if (op.status !== 'cancelled') op.status = 'completed';
        op.metadata.endTime = Date.now();
      });
      const store = {
        ...createMockStore(),
        completeOperation,
        operations,
      } as ReturnType<typeof createMockStore>;
      const get = vi.fn(() => store) as any;
      const handler = createGatewayEventHandler(get, {
        assistantMessageId: 'msg-initial',
        context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
        operationId: 'op-1',
        runLifecycle: buildRunLifecycle(get, {
          context: { agentId: 'agent-1', scope: 'session', topicId: 'topic-1' } as any,
          parentMessageId: 'msg-initial',
          parentMessageType: 'assistant',
          runId: 'op-1',
          runScope: 'top_level',
          runtimeType: 'gateway',
        }),
      });

      handler(makeEvent('agent_runtime_end', { reason: 'interrupted' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(operations['op-1'].status).toBe('cancelled');
    });
  });

  describe('step transition timing (orphan tool regression)', () => {
    /**
     * Verifies that after the executor fix, tools_calling events at step
     * boundaries arrive AFTER stream_start (correct order).
     *
     * Previously, the executor forwarded stream_chunk(tools_calling) sync
     * while stream_start was deferred via persistQueue — handler dispatched
     * tools to the OLD assistant. The fix defers all events during step
     * transition through persistQueue, guaranteeing correct ordering.
     */
    it('should dispatch new-step tools to the NEW assistant when events arrive in correct order', async () => {
      const store = createMockStore();
      const handler = createHandler(store, { assistantMessageId: 'ast-old' });

      // Step 1 init
      handler(makeEvent('stream_start', {}));
      await flush();

      handler(makeEvent('stream_end'));
      await flush();
      vi.clearAllMocks();

      // ── Step boundary: executor now guarantees stream_start arrives FIRST ──
      handler(makeEvent('stream_start', { assistantMessage: { id: 'ast-new' } }));
      await flush();

      handler(
        makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [{ id: 'toolu_new' }],
        }),
      );
      await flush();

      // ── Assert: tools dispatched to the NEW assistant ──
      const toolsDispatch = store.internal_dispatchMessage.mock.calls.find(
        ([action]: any) => action.value?.tools,
      );
      expect(toolsDispatch).toBeDefined();
      expect(toolsDispatch![0].id).toBe('ast-new');
    });
  });

  describe('waiting_for_async_tool parked characterization (lifecycle refactor regression net)', () => {
    // CURRENT BEHAVIOR (gatewayEventHandler.ts:568-589): the `agent_runtime_end`
    // message-reconciliation branch special-cases BOTH `reason='interrupted'`
    // and `reason='waiting_for_async_tool'` together, gated by
    // `hasStreamedContent`. A `waiting_for_async_tool` terminal is a deferred-
    // tool PAUSE (the run parks waiting for an out-of-band async tool result),
    // and the server's `AgentRuntimeCoordinator.resolveUiMessages` deliberately
    // omits the uiMessages snapshot for this status. These tests lock the exact
    // client-side reconciliation the refactor must preserve.

    // (1) Parked WITH streamed content → preserve in-memory streamed content.
    // When the run parks after some server-confirmed state has landed
    // (server-assigned assistant id from stream_start + a text chunk), the
    // handler does NOT refetch from DB and does NOT replace messages — the
    // executor's partial-finalize catch is still racing to write the real
    // content, so a fetch here would clobber it with the LOADING placeholder.
    // This mirrors the `interrupted` skip exactly (same branch).
    it('should NOT refetch from DB when reason=waiting_for_async_tool AND stream had progressed (preserves streamed content)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // Simulate a stream that had progressed: server-assigned assistant id
      // arrived via stream_start, then a text chunk landed (hasStreamedContent).
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-server' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial answer' }));
      await flush();
      vi.mocked(messageService.getMessages).mockClear();
      store.replaceMessages.mockClear();

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      // Streamed content is preserved: no DB read, no replace.
      expect(messageService.getMessages).not.toHaveBeenCalled();
      expect(store.replaceMessages).not.toHaveBeenCalled();
    });

    // (2) Parked WITHOUT streamed content → fall back to DB refetch.
    // If the run parks BEFORE any server-confirmed state landed (no
    // stream_start id, no chunks → hasStreamedContent stays false), the
    // `(interrupted || waiting_for_async_tool) && hasStreamedContent` guard is
    // false, so control falls to the `else` DB-refetch branch. This reconciles
    // the optimistic tmp_* placeholders against server rows. CURRENT BEHAVIOR —
    // verified: the refetch DOES fire here.
    it('should refetch from DB when reason=waiting_for_async_tool but stream never progressed', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      // No stream_start / stream_chunk before the park — hasStreamedContent
      // is still false.
      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      // Refetch IS called (falls through to the else branch).
      expect(messageService.getMessages).toHaveBeenCalled();
      expect(store.replaceMessages).toHaveBeenCalled();
    });

    // (3) uiMessages SoT still wins for a parked terminal. The
    // `Array.isArray(data?.uiMessages)` branch is checked FIRST (line 563),
    // BEFORE the `waiting_for_async_tool && hasStreamedContent` skip. So if a
    // server build DOES attach a snapshot on the park event, it takes
    // precedence over the preserve-streamed-content skip, even though the
    // stream had progressed.
    it('should use uiMessages SoT when reason=waiting_for_async_tool but server included a snapshot (precedence over the skip)', async () => {
      const store = createMockStore();
      const handler = createHandler(store);
      const uiMessages = [{ id: 'msg-server', role: 'assistant', content: 'partial' }];

      // Make the stream progress so hasStreamedContent is true — proving the
      // uiMessages branch wins even when the skip branch would otherwise apply.
      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-server' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial' }));
      await flush();
      vi.mocked(messageService.getMessages).mockClear();
      store.replaceMessages.mockClear();

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool', uiMessages }));
      await flush();

      expect(store.replaceMessages).toHaveBeenCalledWith(uiMessages, {
        action: 'gateway/agent_runtime_end',
        context: expect.any(Object),
      });
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });

    // (4) Operation lifecycle on the parked terminal. A `waiting_for_async_tool`
    // park still completes the operation and tears down tool-calling streaming,
    // but it must NOT mark the topic unread — a park is not a finished
    // generation, and persisting it as `unread` would leave a stale badge on a
    // run that's only paused waiting for an async tool. (See `isCompletedRuntimeEnd`.)
    it('completes the operation but does NOT mark unread on a waiting_for_async_tool park', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('stream_start', { assistantMessage: { id: 'msg-server' } }));
      handler(makeEvent('stream_chunk', { chunkType: 'text', content: 'partial' }));
      await flush();

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool' }));
      await flush();

      // The parked terminal still completes the op + tears down tool streaming,
      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.internal_toggleToolCallingStreaming).toHaveBeenCalledWith(
        'msg-server',
        undefined,
      );
      // …but does NOT surface an unread badge for the pause.
      expect(store.markTopicUnread).not.toHaveBeenCalled();
    });

    // (5) Contrast probe: the no-mark behavior is driven by the park `reason`,
    // not by whether content streamed — a parked terminal with NO streamed
    // content also skips the unread mark.
    it('does NOT mark unread on a waiting_for_async_tool park even with NO streamed content', async () => {
      const store = createMockStore();
      const handler = createHandler(store);

      handler(makeEvent('agent_runtime_end', { reason: 'waiting_for_async_tool' }));
      await flush();

      expect(store.completeOperation).toHaveBeenCalledWith('op-1');
      expect(store.markTopicUnread).not.toHaveBeenCalled();
    });
  });
});
